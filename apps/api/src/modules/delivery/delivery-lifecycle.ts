import { DELIVERY_ERROR_CODES, type DeliveryFailureReason, type DeliveryStatus, type OrderActorType } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, HttpError } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import {
  recordDeliveryAttemptFailed,
  recordDeliveryClosedUndeliverable,
  recordDeliveryCompleted,
  recordDeliveryDispatched,
  type DeliveryNotificationSubject,
} from "../notifications/delivery-notifications.js";
import { lockShopOrder, lockShopShared, markShopOrderDelivered, markShopOrderFailedDelivery, type JobResult, type LockedShopOrder } from "../orders/shop-order-lifecycle.js";
import { shopOrderNotFound } from "../orders/staff-order-views.js";
import { collectPayment } from "../payments/payments.js";
import { isDeliveryInProgress, lockDelivery, type LockedDelivery } from "./delivery.js";

/**
 * The delivery lifecycle (spec 12, sections 4–8; D4, D5, D8, D9).
 *
 * Every transition is a conditional update from the expected status inside
 * one transaction with all of its effects (attempt, history, shop order
 * outcome, payment, stock, notifications), under spec 11's lock order: shop
 * (`FOR SHARE`), shop order (`FOR UPDATE`), delivery (`FOR UPDATE`), then
 * products by ID when stock returns.
 *
 * - An exact repeat of a completed transition writes nothing; the route
 *   returns the current state.
 * - Any other status mismatch → `409 DELIVERY_STATUS_CONFLICT`.
 * - Order of checks: body `400` → another shop's `404` → shop status or
 *   suspended-shop access `403` → status `409`.
 */

const statusConflict = (): HttpError => new HttpError(409, DELIVERY_ERROR_CODES.statusConflict);
const amountMismatch = (): HttpError => new HttpError(409, DELIVERY_ERROR_CODES.amountMismatch);

const DAY_MS = 86_400_000;

/** The seller acting: the shop comes from the guard, never from the client. */
export interface DeliverySeller {
  userId: string;
  shopId: string;
}

/**
 * Which shops may use an operation.
 * - `approved`: `ready` and `dispatch`, approved shops only.
 * - `inProgress`: `delivered`, `fail`, `close`, which the owner of a
 *   suspended shop may still use on a delivery under way (D8).
 */
type Access = "approved" | "inProgress";

type Step = "applied" | "repeat";

interface Context {
  shopOrder: LockedShopOrder;
  delivery: LockedDelivery;
  at: Date;
}

/** Test-only fault injection, to prove rollback. */
export interface DeliveryLifecycleFaults {
  /** Runs inside the transition's (or the job's) transaction, after every write. */
  beforeCommit?: () => void | Promise<void>;
}

export interface DeliveryLifecycleOptions {
  /** `DELIVERY_FAILED_AUTO_CLOSE_DAYS`, applied when a failure is recorded (D5). */
  failedAutoCloseDays: number;
  faults?: DeliveryLifecycleFaults;
}

const subjectOf = (shopOrder: LockedShopOrder): DeliveryNotificationSubject => ({
  shopOrderId: shopOrder.id,
  orderReference: shopOrder.orderReference,
  shopName: shopOrder.shopName,
  customerUserId: shopOrder.customerUserId,
});

interface DeliveryEventInput {
  deliveryId: string;
  from: DeliveryStatus;
  to: DeliveryStatus;
  actorType: OrderActorType;
  actorUserId: string | null;
  reasonCode?: DeliveryFailureReason | null;
  at: Date;
}

async function writeDeliveryEvent(tx: Prisma.TransactionClient, input: DeliveryEventInput): Promise<string> {
  const event = await tx.deliveryStatusEvent.create({
    data: {
      deliveryId: input.deliveryId,
      fromStatus: input.from,
      toStatus: input.to,
      actorType: input.actorType,
      actorUserId: input.actorUserId,
      reasonCode: input.reasonCode ?? null,
      createdAt: input.at,
    },
    select: { id: true },
  });
  return event.id;
}

/** `from` → `to`, only if the delivery is still exactly as locked. Otherwise a broken invariant: `409`. */
async function moveDelivery(
  tx: Prisma.TransactionClient,
  delivery: LockedDelivery,
  to: DeliveryStatus,
  data: { autoCloseAt?: Date | null },
  at: Date,
): Promise<void> {
  const updated = await tx.delivery.updateMany({
    where: { id: delivery.id, status: delivery.status, closedAt: null },
    data: { status: to, ...data, updatedAt: at },
  });
  if (updated.count !== 1) throw statusConflict();
}

/** Records the outcome of the open attempt, once. The attempt history is never overwritten. */
async function closeOpenAttempt(
  tx: Prisma.TransactionClient,
  deliveryId: string,
  outcome: { kind: "DELIVERED" } | { kind: "FAILED"; reason: DeliveryFailureReason },
  sellerUserId: string,
  at: Date,
): Promise<string> {
  const open = await tx.deliveryAttempt.findFirst({ where: { deliveryId, outcome: null }, select: { id: true } });
  if (open === null) throw statusConflict();
  const updated = await tx.deliveryAttempt.updateMany({
    where: { id: open.id, outcome: null },
    data: {
      outcome: outcome.kind,
      failureReason: outcome.kind === "FAILED" ? outcome.reason : null,
      outcomeAt: at,
      outcomeByUserId: sellerUserId,
    },
  });
  if (updated.count !== 1) throw statusConflict();
  return open.id;
}

/**
 * Closes an open failure as undeliverable (seller or job): `closedAt` set, the
 * shop order `FAILED_DELIVERY` with its stock returned and payment `FAILED`
 * (spec 11, spec 13), history, and the customer told. For the job the update
 * also requires `autoCloseAt < now`, so a second run, or a racing seller
 * action, changes nothing. Returns `false`, writing nothing, if the delivery
 * is no longer an open (due) failure.
 */
async function closeFailure(
  tx: Prisma.TransactionClient,
  shopOrder: LockedShopOrder,
  delivery: LockedDelivery,
  actor: { type: "SELLER" | "SYSTEM"; userId: string | null },
  at: Date,
): Promise<boolean> {
  const updated = await tx.delivery.updateMany({
    where: { id: delivery.id, status: "FAILED", closedAt: null, ...(actor.type === "SYSTEM" ? { autoCloseAt: { lt: at } } : {}) },
    data: { closedAt: at, updatedAt: at },
  });
  if (updated.count !== 1) return false;
  const eventId = await writeDeliveryEvent(tx, { deliveryId: delivery.id, from: "FAILED", to: "FAILED", actorType: actor.type, actorUserId: actor.userId, at });
  if (!(await markShopOrderFailedDelivery(tx, shopOrder.id, actor, at))) throw statusConflict();
  await recordDeliveryClosedUndeliverable(tx, subjectOf(shopOrder), eventId);
  return true;
}

/**
 * The automatic closure job (D5, section 6): bounded batches of open failures
 * past `autoCloseAt`, one transaction each, with the same effects as a seller
 * closure. The conditional update makes a second run, or a racing seller
 * action, change nothing. One failing delivery is counted and retried by the
 * next run without stopping the batch. Runs in the worker under its own
 * advisory lock.
 */
export async function closeDueDeliveries(prisma: PrismaClient, batchSize = 100, faults: DeliveryLifecycleFaults = {}): Promise<JobResult> {
  const due = await prisma.delivery.findMany({
    where: { status: "FAILED", closedAt: null, autoCloseAt: { lt: new Date() } },
    orderBy: [{ autoCloseAt: "asc" }, { id: "asc" }],
    take: batchSize,
    select: { shopOrderId: true, shopOrder: { select: { shopId: true } } },
  });
  const result: JobResult = { done: 0, failed: 0 };
  for (const row of due) {
    try {
      const done = await prisma.$transaction(async (tx) => {
        await lockShopShared(tx, row.shopOrder.shopId);
        const shopOrder = await lockShopOrder(tx, row.shopOrderId);
        const delivery = shopOrder === null ? null : await lockDelivery(tx, row.shopOrderId);
        if (shopOrder === null || delivery === null) return false;
        const closed = await closeFailure(tx, shopOrder, delivery, { type: "SYSTEM", userId: null }, new Date());
        if (closed) await faults.beforeCommit?.();
        return closed;
      });
      if (done) result.done += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

export class DeliveryLifecycle {
  private readonly faults: DeliveryLifecycleFaults;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: DeliveryLifecycleOptions,
  ) {
    this.faults = options.faults ?? {};
  }

  /** `PENDING` → `ASSIGNED`: prepared, and the seller has arranged who delivers. Optional. */
  ready(seller: DeliverySeller, shopOrderId: string): Promise<Step> {
    return this.transition(seller, shopOrderId, "approved", async (tx, { delivery, at }) => {
      if (delivery.status === "ASSIGNED") return "repeat";
      if (delivery.status !== "PENDING") throw statusConflict();
      await moveDelivery(tx, delivery, "ASSIGNED", {}, at);
      await writeDeliveryEvent(tx, { deliveryId: delivery.id, from: "PENDING", to: "ASSIGNED", actorType: "SELLER", actorUserId: seller.userId, at });
      return "applied";
    });
  }

  /**
   * `PENDING` or `ASSIGNED` → `OUT_FOR_DELIVERY` (attempt 1), or an open
   * `FAILED` → `OUT_FOR_DELIVERY` (the next attempt; the deadline is cleared).
   * No attempt limit (D5). Approved shops only: a suspended shop's failure
   * can only be closed (D8).
   */
  dispatch(seller: DeliverySeller, shopOrderId: string): Promise<Step> {
    return this.transition(seller, shopOrderId, "approved", async (tx, { shopOrder, delivery, at }) => {
      if (delivery.status === "OUT_FOR_DELIVERY") return "repeat";
      const retry = delivery.status === "FAILED" && delivery.closedAt === null;
      if (delivery.status !== "PENDING" && delivery.status !== "ASSIGNED" && !retry) throw statusConflict();
      if (shopOrder.status !== "CONFIRMED") throw statusConflict();
      await moveDelivery(tx, delivery, "OUT_FOR_DELIVERY", { autoCloseAt: null }, at);
      const last = await tx.deliveryAttempt.findFirst({ where: { deliveryId: delivery.id }, orderBy: { number: "desc" }, select: { number: true } });
      const attempt = await tx.deliveryAttempt.create({
        data: { deliveryId: delivery.id, number: (last?.number ?? 0) + 1, dispatchedAt: at, dispatchedByUserId: seller.userId },
        select: { id: true, number: true },
      });
      await writeDeliveryEvent(tx, { deliveryId: delivery.id, from: delivery.status, to: "OUT_FOR_DELIVERY", actorType: "SELLER", actorUserId: seller.userId, at });
      await recordDeliveryDispatched(tx, subjectOf(shopOrder), attempt);
      return "applied";
    });
  }

  /**
   * "Delivered, cash received" (D9): `OUT_FOR_DELIVERY` → `DELIVERED`, the
   * attempt closed, the shop order `DELIVERED`, and the payment `COLLECTED`,
   * in one transaction, or nothing changes. `shownAmount` is a precondition
   * only: a different value → `409 PAYMENT_AMOUNT_MISMATCH`.
   */
  delivered(seller: DeliverySeller, shopOrderId: string, shownAmount: string): Promise<Step> {
    return this.transition(seller, shopOrderId, "inProgress", async (tx, { shopOrder, delivery, at }) => {
      if (delivery.status === "DELIVERED") return "repeat";
      if (delivery.status !== "OUT_FOR_DELIVERY") throw statusConflict();
      const collection = await collectPayment(tx, { shopOrderId: shopOrder.id, shownAmount, sellerUserId: seller.userId, at });
      if (collection.kind === "amountMismatch") throw amountMismatch();
      if (collection.kind !== "collected") throw statusConflict();
      await closeOpenAttempt(tx, delivery.id, { kind: "DELIVERED" }, seller.userId, at);
      await moveDelivery(tx, delivery, "DELIVERED", {}, at);
      const eventId = await writeDeliveryEvent(tx, { deliveryId: delivery.id, from: "OUT_FOR_DELIVERY", to: "DELIVERED", actorType: "SELLER", actorUserId: seller.userId, at });
      if (!(await markShopOrderDelivered(tx, shopOrder.id, seller.userId, at))) throw statusConflict();
      await recordDeliveryCompleted(tx, subjectOf(shopOrder), eventId, collection.amount);
      return "applied";
    });
  }

  /**
   * `OUT_FOR_DELIVERY` → `FAILED`, with a required reason from the fixed list
   * (D5). The attempt is closed as failed, and the automatic closure deadline
   * is set from the configuration at this moment. Repeating it with the same
   * reason writes nothing.
   */
  fail(seller: DeliverySeller, shopOrderId: string, reason: DeliveryFailureReason): Promise<Step> {
    return this.transition(seller, shopOrderId, "inProgress", async (tx, { shopOrder, delivery, at }) => {
      if (delivery.status === "FAILED" && delivery.closedAt === null) {
        const last = await tx.deliveryAttempt.findFirst({ where: { deliveryId: delivery.id }, orderBy: { number: "desc" }, select: { failureReason: true } });
        if (last?.failureReason === reason) return "repeat";
        throw statusConflict();
      }
      if (delivery.status !== "OUT_FOR_DELIVERY") throw statusConflict();
      const attemptId = await closeOpenAttempt(tx, delivery.id, { kind: "FAILED", reason }, seller.userId, at);
      await moveDelivery(tx, delivery, "FAILED", { autoCloseAt: new Date(at.getTime() + this.options.failedAutoCloseDays * DAY_MS) }, at);
      await writeDeliveryEvent(tx, { deliveryId: delivery.id, from: "OUT_FOR_DELIVERY", to: "FAILED", actorType: "SELLER", actorUserId: seller.userId, reasonCode: reason, at });
      await recordDeliveryAttemptFailed(tx, subjectOf(shopOrder), attemptId, reason);
      return "applied";
    });
  }

  /** An open `FAILED` → closed (final, undeliverable), by the seller. */
  close(seller: DeliverySeller, shopOrderId: string): Promise<Step> {
    return this.transition(seller, shopOrderId, "inProgress", async (tx, { shopOrder, delivery, at }) => {
      if (delivery.status === "FAILED" && delivery.closedAt !== null) return "repeat";
      if (delivery.status !== "FAILED") throw statusConflict();
      if (!(await closeFailure(tx, shopOrder, delivery, { type: "SELLER", userId: seller.userId }, at))) throw statusConflict();
      return "applied";
    });
  }

  /** The automatic closure job, with this lifecycle's fault hooks (tests). */
  closeDue(batchSize = 100): Promise<JobResult> {
    return closeDueDeliveries(this.prisma, batchSize, this.faults);
  }

  /**
   * Resolves the shop order within the seller's own shop (another shop's →
   * `404`), then in one transaction: the shop (`FOR SHARE`, re-checking its
   * status), the shop order and its delivery (`FOR UPDATE`), the narrow
   * suspended-shop rule, and the step.
   */
  private async transition(
    seller: DeliverySeller,
    shopOrderId: string,
    access: Access,
    step: (tx: Prisma.TransactionClient, context: Context) => Promise<Step>,
  ): Promise<Step> {
    const found = await this.prisma.shopOrder.findFirst({ where: { id: shopOrderId, shopId: seller.shopId }, select: { id: true } });
    if (found === null) throw shopOrderNotFound();
    return this.prisma.$transaction(async (tx) => {
      const shopStatus = await lockShopShared(tx, seller.shopId);
      const suspended = shopStatus === "SUSPENDED";
      if (shopStatus !== "APPROVED" && !(access === "inProgress" && suspended)) throw forbidden();
      const shopOrder = await lockShopOrder(tx, shopOrderId);
      if (shopOrder === null) throw shopOrderNotFound();
      const delivery = await lockDelivery(tx, shopOrderId);
      // A suspended shop may only finish deliveries already under way (D8).
      if (suspended && (delivery === null || !isDeliveryInProgress(delivery))) throw forbidden();
      // Not confirmed yet, or never confirmed: no delivery to act on.
      if (delivery === null) throw statusConflict();
      const result = await step(tx, { shopOrder, delivery, at: new Date() });
      if (result === "applied") await this.faults.beforeCommit?.();
      return result;
    });
  }
}
