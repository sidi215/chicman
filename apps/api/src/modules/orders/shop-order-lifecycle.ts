import {
  ORDER_ERROR_CODES,
  SHOP_ERROR_CODES,
  type AdminOrderCancellationInput,
  type CustomerCancellationInput,
  type OrderActorType,
  type SellerCancellationReason,
  type SellerRejectionReason,
  type ShopOrderReasonCode,
  type ShopOrderStatus,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { CANCELLABLE_DELIVERY_STATUSES, cancelDelivery, createDelivery, lockDelivery, type LockedDelivery } from "../delivery/delivery.js";
import { lockProductsForStock, returnOrderStock } from "../inventory/order-stock.js";
import {
  recordShopOrderCancelled,
  recordShopOrderConfirmed,
  recordShopOrderExpired,
  recordShopOrderRejected,
  recordShopOrderResponseReminder,
  type ShopOrderNotificationSubject,
} from "../notifications/order-notifications.js";
import { markPaymentCancelled, markPaymentFailed } from "../payments/payments.js";
import { shopOrderNotFound } from "./staff-order-views.js";

/**
 * The shop order lifecycle (spec 11, sections 5–9; D4, D6, D7, D8).
 *
 * Every transition has an authorized actor and an expected previous status,
 * and is a conditional update (`WHERE id = … AND status = …`) inside one
 * transaction with all of its effects: delivery, stock, payment, history,
 * and notifications. Lock order everywhere: shop (`FOR SHARE`), shop order
 * (`FOR UPDATE`), delivery, then products by ID. That extends the cart,
 * checkout, and seller orders (cart → shop → product), so nothing deadlocks.
 *
 * - A repeat of a completed transition by the same kind of actor writes
 *   nothing; the route returns the current shop order.
 * - Any other status mismatch → `409 SHOP_ORDER_STATUS_CONFLICT`.
 * - A pending shop order past `respondBy` is expired first, in the request's
 *   own transaction with the job's effects, and the request gets
 *   `409 SHOP_ORDER_EXPIRED`: the outcome depends only on the time.
 */

const statusConflict = (): HttpError => new HttpError(409, ORDER_ERROR_CODES.statusConflict);
const expiredError = (): HttpError => new HttpError(409, ORDER_ERROR_CODES.expired);

export interface LockedShopOrder {
  id: string;
  orderId: string;
  shopId: string;
  status: ShopOrderStatus;
  respondBy: Date;
  cancelledBy: OrderActorType | null;
  shopName: string;
  orderReference: string;
  customerUserId: string;
  sellerUserId: string;
}

/** Locks the shop order (after its shop), with what its notifications need. */
export async function lockShopOrder(tx: Prisma.TransactionClient, shopOrderId: string): Promise<LockedShopOrder | null> {
  const rows = await tx.$queryRaw<LockedShopOrder[]>`
    SELECT so."id", so."orderId", so."shopId", so."status"::text AS "status", so."respondBy",
           so."cancelledBy"::text AS "cancelledBy", so."shopName",
           o."reference" AS "orderReference", o."userId" AS "customerUserId", s."ownerUserId" AS "sellerUserId"
    FROM "ShopOrder" so
    JOIN "Order" o ON o."id" = so."orderId"
    JOIN "Shop" s ON s."id" = so."shopId"
    WHERE so."id" = ${shopOrderId}::uuid
    FOR UPDATE OF so`;
  return rows[0] ?? null;
}

/** The shop's status under a shared lock: a suspension waits for this transaction, and the reverse. */
export async function lockShopShared(tx: Prisma.TransactionClient, shopId: string): Promise<string | null> {
  const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS "status" FROM "Shop" WHERE "id" = ${shopId}::uuid FOR SHARE`;
  return rows[0]?.status ?? null;
}

const subjectOf = (shopOrder: LockedShopOrder): ShopOrderNotificationSubject => ({
  shopOrderId: shopOrder.id,
  orderReference: shopOrder.orderReference,
  shopName: shopOrder.shopName,
  customerUserId: shopOrder.customerUserId,
  sellerUserId: shopOrder.sellerUserId,
});

interface StatusEventInput {
  shopOrderId: string;
  from: ShopOrderStatus;
  to: ShopOrderStatus;
  actorType: OrderActorType;
  actorUserId: string | null;
  reasonCode?: ShopOrderReasonCode | null;
  reasonText?: string | null;
  internalReason?: string | null;
  internalNote?: string | null;
  at: Date;
}

async function writeStatusEvent(tx: Prisma.TransactionClient, input: StatusEventInput): Promise<string> {
  const event = await tx.shopOrderStatusEvent.create({
    data: {
      shopOrderId: input.shopOrderId,
      fromStatus: input.from,
      toStatus: input.to,
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode ?? null,
      reasonText: input.reasonText ?? null,
      internalReason: input.internalReason ?? null,
      internalNote: input.internalNote ?? null,
      createdAt: input.at,
    },
    select: { id: true },
  });
  return event.id;
}

/** A final transition that ends a shop order without delivery, or as undeliverable. */
interface Ending {
  to: "REJECTED" | "CANCELLED" | "EXPIRED" | "FAILED_DELIVERY";
  actorType: OrderActorType;
  actorUserId: string | null;
  reasonCode?: ShopOrderReasonCode | null;
  reasonText?: string | null;
  internalReason?: string | null;
  internalNote?: string | null;
  /** The seller's answer (rejection) sets `decidedAt`. */
  decision?: boolean;
}

/**
 * Applies an ending and all its effects: the conditional update, the
 * delivery's cancellation (only `PENDING` or `ASSIGNED`, otherwise `409`),
 * the stock return (once per item), the payment closure, and the history.
 * Returns the status event, which keys the notifications.
 */
async function endShopOrder(tx: Prisma.TransactionClient, shopOrder: LockedShopOrder, ending: Ending, delivery: LockedDelivery | null, at: Date): Promise<string> {
  const updated = await tx.shopOrder.updateMany({
    where: { id: shopOrder.id, status: shopOrder.status },
    data: {
      status: ending.to,
      closedAt: at,
      ...(ending.decision === true ? { decidedAt: at } : {}),
      ...(ending.to === "CANCELLED" ? { cancelledBy: ending.actorType } : {}),
      reasonCode: ending.reasonCode ?? null,
      reasonText: ending.reasonText ?? null,
      internalReason: ending.internalReason ?? null,
      internalNote: ending.internalNote ?? null,
      updatedAt: at,
    },
  });
  // The row is locked, so only a broken invariant gets here.
  if (updated.count !== 1) throw statusConflict();
  if (delivery !== null && ending.to === "CANCELLED" && !(await cancelDelivery(tx, delivery, at))) throw statusConflict();
  await returnOrderStock(tx, shopOrder.id, at);
  const closure = { shopOrderId: shopOrder.id, actorType: ending.actorType, actorUserId: ending.actorUserId, at };
  if (ending.to === "FAILED_DELIVERY") await markPaymentFailed(tx, closure);
  else await markPaymentCancelled(tx, closure);
  return writeStatusEvent(tx, {
    shopOrderId: shopOrder.id,
    from: shopOrder.status,
    to: ending.to,
    actorType: ending.actorType,
    actorUserId: ending.actorUserId,
    reasonCode: ending.reasonCode ?? null,
    reasonText: ending.reasonText ?? null,
    internalReason: ending.internalReason ?? null,
    internalNote: ending.internalNote ?? null,
    at,
  });
}

/** `PENDING` → `EXPIRED` (D7): stock returned, payment `CANCELLED`, history, customer and seller notified. */
async function expireShopOrder(tx: Prisma.TransactionClient, shopOrder: LockedShopOrder, at: Date): Promise<void> {
  const eventId = await endShopOrder(tx, shopOrder, { to: "EXPIRED", actorType: "SYSTEM", actorUserId: null }, null, at);
  await recordShopOrderExpired(tx, subjectOf(shopOrder), eventId);
}

/** Past its deadline, a pending shop order can no longer be answered (D7). */
const isPastDeadline = (shopOrder: LockedShopOrder, at: Date): boolean => shopOrder.status === "PENDING" && at >= shopOrder.respondBy;

export interface SuspensionResult {
  cancelled: number;
  expired: number;
  /** Deliveries already under way: left to the owner (spec 12). */
  untouched: number;
}

/**
 * Called by spec 06's suspension transaction, with the shop already locked
 * (D8). Cancels, with reason `SHOP_UNAVAILABLE`, every shop order of the shop
 * that is `PENDING`, or `CONFIRMED` with a delivery that has not left, with
 * the effects of section 5 (delivery cancelled, stock returned, payment
 * `CANCELLED`, history, notifications). A pending order already past its
 * deadline expires instead, as it would at that time anyway. Deliveries out
 * for delivery or failed are not touched. Reinstatement restores nothing.
 */
export async function cancelShopOrdersForSuspension(tx: Prisma.TransactionClient, shopId: string, at: Date): Promise<SuspensionResult> {
  const open = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ShopOrder" WHERE "shopId" = ${shopId}::uuid AND "status" IN ('PENDING', 'CONFIRMED') ORDER BY "id" FOR UPDATE`;
  const result: SuspensionResult = { cancelled: 0, expired: 0, untouched: 0 };
  if (open.length === 0) return result;

  const shopOrders: { shopOrder: LockedShopOrder; delivery: LockedDelivery | null }[] = [];
  for (const { id } of open) {
    const shopOrder = await lockShopOrder(tx, id);
    if (shopOrder === null) continue;
    shopOrders.push({ shopOrder, delivery: shopOrder.status === "CONFIRMED" ? await lockDelivery(tx, id) : null });
  }
  const items = await tx.orderItem.findMany({ where: { shopOrderId: { in: open.map(({ id }) => id) } }, select: { productId: true } });
  // All of this shop's products at once, by ID, before any stock moves.
  await lockProductsForStock(tx, items.map(({ productId }) => productId));

  for (const { shopOrder, delivery } of shopOrders) {
    if (isPastDeadline(shopOrder, at)) {
      await expireShopOrder(tx, shopOrder, at);
      result.expired += 1;
      continue;
    }
    if (shopOrder.status === "CONFIRMED" && (delivery === null || !CANCELLABLE_DELIVERY_STATUSES.includes(delivery.status))) {
      result.untouched += 1;
      continue;
    }
    const eventId = await endShopOrder(
      tx,
      shopOrder,
      { to: "CANCELLED", actorType: "SYSTEM", actorUserId: null, reasonCode: "SHOP_UNAVAILABLE" },
      delivery,
      at,
    );
    await recordShopOrderCancelled(tx, subjectOf(shopOrder), eventId, "CHICMAN", "SHOP_UNAVAILABLE");
    result.cancelled += 1;
  }
  return result;
}

/**
 * The outcome set by the delivery reaching `DELIVERED` (spec 12's delivered
 * action only, in its transaction, together with the payment's collection by
 * spec 13). `CONFIRMED` → `DELIVERED`; no stock moves (D1, D10). Returns
 * `false`, writing nothing, from any other status.
 */
export async function markShopOrderDelivered(tx: Prisma.TransactionClient, shopOrderId: string, sellerUserId: string, at: Date): Promise<boolean> {
  const shopOrder = await lockShopOrder(tx, shopOrderId);
  if (shopOrder === null || shopOrder.status !== "CONFIRMED") return false;
  const updated = await tx.shopOrder.updateMany({ where: { id: shopOrderId, status: "CONFIRMED" }, data: { status: "DELIVERED", closedAt: at, updatedAt: at } });
  if (updated.count !== 1) return false;
  await writeStatusEvent(tx, { shopOrderId, from: "CONFIRMED", to: "DELIVERED", actorType: "SELLER", actorUserId: sellerUserId, at });
  return true;
}

/**
 * The outcome set by the delivery's final closure as undeliverable (spec 12:
 * the seller, or its automatic closure job). `CONFIRMED` → `FAILED_DELIVERY`,
 * stock returned, payment `FAILED`. Returns `false`, writing nothing, from
 * any other status.
 */
export async function markShopOrderFailedDelivery(
  tx: Prisma.TransactionClient,
  shopOrderId: string,
  actor: { type: "SELLER" | "SYSTEM"; userId: string | null },
  at: Date,
): Promise<boolean> {
  const shopOrder = await lockShopOrder(tx, shopOrderId);
  if (shopOrder === null || shopOrder.status !== "CONFIRMED") return false;
  await endShopOrder(tx, shopOrder, { to: "FAILED_DELIVERY", actorType: actor.type, actorUserId: actor.userId }, null, at);
  return true;
}

/** Test-only fault injection, to prove rollback. */
export interface ShopOrderLifecycleFaults {
  /** Runs inside the transition's transaction, after every write. */
  beforeCommit?: () => void | Promise<void>;
}

/** Who acts, and how the shop order is looked up for them. */
type Access =
  | { kind: "seller"; shopId: string }
  | { kind: "customer"; userId: string; orderId: string }
  | { kind: "admin"; userId: string };

type Step = "applied" | "repeat";

export interface JobResult {
  done: number;
  failed: number;
}

export class ShopOrderLifecycle {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: ShopOrderLifecycleFaults = {},
  ) {}

  /** `PENDING` → `CONFIRMED` by the seller, before `respondBy`. Creates the delivery (`PENDING`, spec 12). */
  confirm(seller: { userId: string; shopId: string }, shopOrderId: string): Promise<Step> {
    return this.transition(shopOrderId, { kind: "seller", shopId: seller.shopId }, async (tx, shopOrder, at) => {
      if (shopOrder.status === "CONFIRMED") return "repeat";
      if (shopOrder.status === "EXPIRED") throw expiredError();
      if (shopOrder.status !== "PENDING") throw statusConflict();
      const updated = await tx.shopOrder.updateMany({
        where: { id: shopOrder.id, status: "PENDING" },
        data: { status: "CONFIRMED", decidedAt: at, updatedAt: at },
      });
      if (updated.count !== 1) throw statusConflict();
      await createDelivery(tx, shopOrder.id, at);
      const eventId = await writeStatusEvent(tx, { shopOrderId: shopOrder.id, from: "PENDING", to: "CONFIRMED", actorType: "SELLER", actorUserId: seller.userId, at });
      await recordShopOrderConfirmed(tx, subjectOf(shopOrder), eventId);
      return "applied";
    });
  }

  /** `PENDING` → `REJECTED` by the seller, before `respondBy`, with a required reason. */
  reject(seller: { userId: string; shopId: string }, shopOrderId: string, reason: SellerRejectionReason): Promise<Step> {
    return this.transition(shopOrderId, { kind: "seller", shopId: seller.shopId }, async (tx, shopOrder, at) => {
      if (shopOrder.status === "REJECTED") return "repeat";
      if (shopOrder.status === "EXPIRED") throw expiredError();
      if (shopOrder.status !== "PENDING") throw statusConflict();
      const eventId = await endShopOrder(
        tx,
        shopOrder,
        { to: "REJECTED", actorType: "SELLER", actorUserId: seller.userId, reasonCode: reason, decision: true },
        null,
        at,
      );
      await recordShopOrderRejected(tx, subjectOf(shopOrder), eventId, reason);
      return "applied";
    });
  }

  /** `CONFIRMED` → `CANCELLED` by the seller, while the delivery has not left, with a required reason. */
  cancelBySeller(seller: { userId: string; shopId: string }, shopOrderId: string, reason: SellerCancellationReason): Promise<Step> {
    return this.transition(shopOrderId, { kind: "seller", shopId: seller.shopId }, async (tx, shopOrder, at) => {
      if (shopOrder.status === "CANCELLED" && shopOrder.cancelledBy === "SELLER") return "repeat";
      if (shopOrder.status === "EXPIRED") throw expiredError();
      if (shopOrder.status !== "CONFIRMED") throw statusConflict();
      const delivery = await this.cancellableDelivery(tx, shopOrder.id);
      const eventId = await endShopOrder(tx, shopOrder, { to: "CANCELLED", actorType: "SELLER", actorUserId: seller.userId, reasonCode: reason }, delivery, at);
      await recordShopOrderCancelled(tx, subjectOf(shopOrder), eventId, "SELLER", reason);
      return "applied";
    });
  }

  /** `PENDING` → `CANCELLED` by the customer, before `respondBy`. The reason is optional; `OTHER` carries the text. */
  cancelByCustomer(customer: { userId: string; orderId: string }, shopOrderId: string, input: CustomerCancellationInput): Promise<Step> {
    return this.transition(shopOrderId, { kind: "customer", userId: customer.userId, orderId: customer.orderId }, async (tx, shopOrder, at) => {
      if (shopOrder.status === "CANCELLED" && shopOrder.cancelledBy === "CUSTOMER") return "repeat";
      if (shopOrder.status === "EXPIRED") throw expiredError();
      if (shopOrder.status !== "PENDING") throw statusConflict();
      const reasonCode = input.reason ?? null;
      const eventId = await endShopOrder(
        tx,
        shopOrder,
        { to: "CANCELLED", actorType: "CUSTOMER", actorUserId: customer.userId, reasonCode, reasonText: input.reasonText ?? null },
        null,
        at,
      );
      // Codes only: the customer's text never goes into a notification.
      await recordShopOrderCancelled(tx, subjectOf(shopOrder), eventId, "CUSTOMER", reasonCode);
      return "applied";
    });
  }

  /**
   * `PENDING`, or `CONFIRMED` with the delivery not out, → `CANCELLED` by an
   * administrator, never on a shop they own (`403`). The internal reason and
   * note stay internal: notifications say "Chicman" with no reason.
   */
  cancelByAdmin(adminUserId: string, shopOrderId: string, input: AdminOrderCancellationInput): Promise<Step> {
    return this.transition(shopOrderId, { kind: "admin", userId: adminUserId }, async (tx, shopOrder, at) => {
      if (shopOrder.status === "CANCELLED" && shopOrder.cancelledBy === "ADMIN") return "repeat";
      if (shopOrder.status === "EXPIRED") throw expiredError();
      if (shopOrder.status !== "PENDING" && shopOrder.status !== "CONFIRMED") throw statusConflict();
      const delivery = shopOrder.status === "CONFIRMED" ? await this.cancellableDelivery(tx, shopOrder.id) : null;
      const eventId = await endShopOrder(
        tx,
        shopOrder,
        {
          to: "CANCELLED",
          actorType: "ADMIN",
          actorUserId: adminUserId,
          internalReason: input.internalReason,
          internalNote: input.internalNote ?? null,
        },
        delivery,
        at,
      );
      await recordShopOrderCancelled(tx, subjectOf(shopOrder), eventId, "CHICMAN", null);
      return "applied";
    });
  }

  /**
   * The expiry job (D7): bounded batches of `PENDING` shop orders past
   * `respondBy`, one transaction each. The conditional update means a second
   * run, or a request that already expired one, changes nothing.
   */
  async expireDue(batchSize = 100): Promise<JobResult> {
    const due = await this.prisma.shopOrder.findMany({
      where: { status: "PENDING", respondBy: { lte: new Date() } },
      orderBy: [{ respondBy: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true, shopId: true },
    });
    return this.eachInTransaction(due, async (tx, shopOrder, at) => {
      if (!isPastDeadline(shopOrder, at)) return false;
      await expireShopOrder(tx, shopOrder, at);
      return true;
    });
  }

  /**
   * The reminder job (D7): one seller notification per `PENDING` shop order
   * once `remindAt` has passed and before the deadline. Its event key is the
   * shop order, so it can never be recorded twice. The key is looked up in the
   * event ledger, which outlives the notification (spec 15, O6.3).
   */
  async remindDue(batchSize = 100): Promise<JobResult> {
    const due = await this.prisma.$queryRaw<{ id: string; shopId: string }[]>`
      SELECT so."id", so."shopId" FROM "ShopOrder" so
      JOIN "Shop" s ON s."id" = so."shopId"
      WHERE so."status" = 'PENDING' AND so."remindAt" <= now() AND so."respondBy" > now()
        AND NOT EXISTS (
          SELECT 1 FROM "NotificationEvent" e
          WHERE e."eventKey" = 'SHOP_ORDER_RESPONSE_REMINDER:' || so."id"::text || ':' || s."ownerUserId"::text
        )
      ORDER BY so."remindAt", so."id"
      LIMIT ${batchSize}`;
    return this.eachInTransaction(due, async (tx, shopOrder, at) => {
      if (shopOrder.status !== "PENDING" || at >= shopOrder.respondBy) return false;
      await recordShopOrderResponseReminder(tx, {
        shopOrderId: shopOrder.id,
        orderReference: shopOrder.orderReference,
        sellerUserId: shopOrder.sellerUserId,
        respondBy: shopOrder.respondBy,
      });
      return true;
    });
  }

  /** A confirmed shop order's delivery, which must not have left; otherwise `409`. */
  private async cancellableDelivery(tx: Prisma.TransactionClient, shopOrderId: string): Promise<LockedDelivery> {
    const delivery = await lockDelivery(tx, shopOrderId);
    if (delivery === null || !CANCELLABLE_DELIVERY_STATUSES.includes(delivery.status)) throw statusConflict();
    return delivery;
  }

  private async eachInTransaction(
    rows: readonly { id: string; shopId: string }[],
    step: (tx: Prisma.TransactionClient, shopOrder: LockedShopOrder, at: Date) => Promise<boolean>,
  ): Promise<JobResult> {
    const result: JobResult = { done: 0, failed: 0 };
    for (const row of rows) {
      try {
        const done = await this.prisma.$transaction(async (tx) => {
          await lockShopShared(tx, row.shopId);
          const shopOrder = await lockShopOrder(tx, row.id);
          return shopOrder === null ? false : step(tx, shopOrder, new Date());
        });
        if (done) result.done += 1;
      } catch {
        // One failing shop order must not stop the batch; the next run retries it.
        result.failed += 1;
      }
    }
    return result;
  }

  /**
   * Resolves the shop order for this actor (another shop's or customer's →
   * `404`), then in one transaction: the shop (`FOR SHARE`, re-checking
   * `APPROVED` for a seller), the shop order (`FOR UPDATE`), the
   * self-administration check, the deadline, and the step.
   */
  private async transition(
    shopOrderId: string,
    access: Access,
    step: (tx: Prisma.TransactionClient, shopOrder: LockedShopOrder, at: Date) => Promise<Step>,
  ): Promise<Step> {
    const shopId = await this.resolveShop(shopOrderId, access);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const shopStatus = await lockShopShared(tx, shopId);
      if (access.kind === "seller" && shopStatus !== "APPROVED") throw forbidden();
      const shopOrder = await lockShopOrder(tx, shopOrderId);
      if (shopOrder === null) throw shopOrderNotFound();
      if (access.kind === "admin" && shopOrder.sellerUserId === access.userId) throw new HttpError(403, SHOP_ERROR_CODES.selfAdministrationForbidden);
      const at = new Date();
      if (isPastDeadline(shopOrder, at)) {
        // Applied and committed; the request is still refused below.
        await expireShopOrder(tx, shopOrder, at);
        return "expired" as const;
      }
      const result = await step(tx, shopOrder, at);
      if (result === "applied") await this.faults.beforeCommit?.();
      return result;
    });
    if (outcome === "expired") throw expiredError();
    return outcome;
  }

  private async resolveShop(shopOrderId: string, access: Access): Promise<string> {
    if (access.kind === "customer") {
      const order = await this.prisma.order.findFirst({ where: { id: access.orderId, userId: access.userId }, select: { id: true } });
      if (order === null) throw notFound(ORDER_ERROR_CODES.notFound);
    }
    const where: Prisma.ShopOrderWhereInput =
      access.kind === "seller" ? { id: shopOrderId, shopId: access.shopId } : access.kind === "customer" ? { id: shopOrderId, orderId: access.orderId } : { id: shopOrderId };
    const found = await this.prisma.shopOrder.findFirst({ where, select: { shopId: true } });
    if (found === null) throw shopOrderNotFound();
    return found.shopId;
  }
}
