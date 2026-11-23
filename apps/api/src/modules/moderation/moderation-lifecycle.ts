import {
  PRODUCT_ERROR_CODES,
  SHOP_ERROR_CODES,
  type AdminModerationCaseDetail,
  type AdminProductDetail,
  type ModerationDismissInput,
  type ModerationResubmitInput,
  type ModerationRestoreInput,
  type ModerationSanctionInput,
  type ProductModerationAction,
  type ProductModerationNotificationType,
  type ProductModerationStatus,
  type SellerProductModerationResponse,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { recordProductModerationNotification, type ProductModerationNotification } from "../notifications/index.js";
import {
  appendModerationEvent,
  caseNotFound,
  lockOpenCase,
  lockProductForUpdate,
  lockShopForShare,
  moderationConflict,
  setModerationStatus,
  type LockedCase,
  type LockedModerationProduct,
  type LockedShop,
} from "./moderation-records.js";
import type { ModerationQueries } from "./moderation-queries.js";

/** Test-only fault injection: proves rollback and exercises races. */
export interface ModerationLifecycleFaults {
  /** Inside the transaction, after every lock is held. */
  afterLocks?: () => void | Promise<void>;
  /** Replaces the notification recording (spec 19, section 9: a failure rolls everything back). */
  recordNotification?: (tx: Prisma.TransactionClient, input: ProductModerationNotification) => Promise<void>;
}

export type AdminProductAction = "restrict" | "request-correction" | "restore" | "remove";

export type AdminProductActionInput =
  | { action: "restrict" | "request-correction" | "remove"; body: ModerationSanctionInput }
  | { action: "restore"; body: ModerationRestoreInput };

const productNotFound = (): HttpError => notFound(PRODUCT_ERROR_CODES.notFound);
const selfAdministration = (): HttpError => new HttpError(403, SHOP_ERROR_CODES.selfAdministrationForbidden);

/** What one admin action does to the product and its case (section 3.2). */
interface Transition {
  action: ProductModerationAction;
  to: ProductModerationStatus;
  notification: ProductModerationNotificationType;
  /** The case after the transition. */
  caseStatus: "ACTIVE" | "CLOSED";
  outcome?: "RESTORED" | "REMOVED";
}

type Plan = { kind: "transition"; transition: Transition } | { kind: "repeat" };

const RESTRICT: Transition = { action: "RESTRICTED", to: "RESTRICTED", notification: "PRODUCT_RESTRICTED", caseStatus: "ACTIVE" };
const CORRECTION: Transition = { action: "CORRECTION_REQUESTED", to: "RESTRICTED", notification: "PRODUCT_CORRECTION_REQUESTED", caseStatus: "ACTIVE" };
const RESTORE: Transition = { action: "RESTORED", to: "CLEAR", notification: "PRODUCT_RESTORED", caseStatus: "CLOSED", outcome: "RESTORED" };
const REMOVE: Transition = { action: "REMOVED", to: "REMOVED", notification: "PRODUCT_REMOVED", caseStatus: "CLOSED", outcome: "REMOVED" };

/**
 * The transition an action makes from a state, a repeat of a completed action
 * (D4: nothing written, the current state returned), or `null` (`409`).
 */
export function planAdminAction(action: AdminProductAction, from: ProductModerationStatus, restoredLast: boolean): Plan | null {
  const go = (transition: Transition): Plan => ({ kind: "transition", transition });
  const repeat: Plan = { kind: "repeat" };
  switch (action) {
    case "restrict":
      // T3. Restricting a restricted product is the same action again.
      if (from === "CLEAR") return go(RESTRICT);
      return from === "RESTRICTED" ? repeat : null;
    case "request-correction":
      // T3 (the first request) or T5 (after a resubmission).
      if (from === "CLEAR") return go(RESTRICT);
      if (from === "IN_REVIEW") return go(CORRECTION);
      return from === "RESTRICTED" ? repeat : null;
    case "restore":
      // T6. A `CLEAR` product is a repeat only right after its restoration.
      if (from === "RESTRICTED" || from === "IN_REVIEW") return go(RESTORE);
      return from === "CLEAR" && restoredLast ? repeat : null;
    case "remove":
      // T7 from any state but `REMOVED`, which has no way out (PD-9).
      return from === "REMOVED" ? repeat : go(REMOVE);
  }
}

/**
 * Product moderation actions (spec 19, sections 3 and 8.3). Every action is one
 * transaction: shop `FOR SHARE` → product `FOR UPDATE` → case `FOR UPDATE`
 * (the seller, cart, and checkout lock order), then the conditional state
 * update, the case update, the event, and the seller notification. Checkout
 * and a restriction therefore serialize on the product row. Nothing here
 * changes orders, payments, deliveries, or stock (PD-11).
 */
export class ModerationLifecycle {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly queries: ModerationQueries,
    private readonly faults: ModerationLifecycleFaults = {},
  ) {}

  /** T3, T5, T6, T7 (`POST /admin/products/:productId/moderation/…`). */
  async adminAct(adminUserId: string, productId: string, input: AdminProductActionInput): Promise<AdminProductDetail> {
    return this.prisma.$transaction(async (tx) => {
      const { shop, product } = await this.lockForAdmin(tx, adminUserId, productId);
      const openCase = await lockOpenCase(tx, productId);
      await this.faults.afterLocks?.();

      const restoredLast = product.moderationStatus === "CLEAR" && openCase === null && (await this.lastOutcome(tx, productId)) === "RESTORED";
      const plan = planAdminAction(input.action, product.moderationStatus, restoredLast);
      if (plan === null) throw moderationConflict();
      // A transition from a state other than the one the administrator acted on
      // is a conflicting concurrent change (section 3.2): exactly one of two
      // racing actions applies. A repeat (D4) is not refused.
      if (plan.kind === "transition" && input.body.expectedStatus !== product.moderationStatus) throw moderationConflict();
      if (plan.kind === "transition") await this.applyAdminTransition(tx, adminUserId, shop, product, openCase, plan.transition, input);
      return this.queries.adminProduct(productId, adminUserId, tx);
    });
  }

  /** T2: dismisses an `OPEN` case; the product is unchanged (`CLEAR`). */
  async dismiss(adminUserId: string, caseId: string, body: ModerationDismissInput): Promise<AdminModerationCaseDetail> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.productModerationCase.findUnique({ where: { id: caseId }, select: { productId: true } });
      if (target === null) throw caseNotFound();
      const { product } = await this.lockForAdmin(tx, adminUserId, target.productId);
      const rows = await tx.$queryRaw<{ status: string; outcome: string | null }[]>`
        SELECT "status"::text AS "status", "outcome"::text AS "outcome" FROM "ProductModerationCase" WHERE "id" = ${caseId}::uuid FOR UPDATE`;
      const locked = rows[0];
      if (locked === undefined) throw caseNotFound();
      await this.faults.afterLocks?.();

      if (locked.status === "CLOSED" && locked.outcome === "DISMISSED") return this.queries.caseDetail(caseId, adminUserId, tx);
      if (locked.status !== "OPEN" || product.moderationStatus !== "CLEAR") throw moderationConflict();
      const closed = await tx.productModerationCase.updateMany({
        where: { id: caseId, status: "OPEN" },
        data: { status: "CLOSED", outcome: "DISMISSED", closedAt: new Date(), closedByUserId: adminUserId },
      });
      if (closed.count !== 1) throw moderationConflict();
      await appendModerationEvent(tx, {
        productId: product.id,
        caseId,
        action: "DISMISSED",
        fromStatus: "CLEAR",
        toStatus: "CLEAR",
        actorType: "ADMIN",
        actorUserId: adminUserId,
        internalReason: body.internalReason,
        internalNote: body.internalNote ?? null,
      });
      return this.queries.caseDetail(caseId, adminUserId, tx);
    });
  }

  /**
   * T4: the owning seller resubmits a `RESTRICTED` product (shop `APPROVED`,
   * not archived, at least one active image). No notification. Anything else,
   * including a second resubmission while `IN_REVIEW`, is a conflict.
   */
  async resubmit(seller: { userId: string; shopId: string }, productId: string, body: ModerationResubmitInput): Promise<SellerProductModerationResponse> {
    return this.prisma.$transaction(async (tx) => {
      const shop = await lockShopForShare(tx, seller.shopId);
      if (shop === null || shop.ownerUserId !== seller.userId || shop.status !== "APPROVED") throw forbidden();
      const product = await lockProductForUpdate(tx, seller.shopId, productId);
      if (product === null) throw productNotFound();
      const openCase = await lockOpenCase(tx, productId);
      await this.faults.afterLocks?.();

      if (product.moderationStatus !== "RESTRICTED" || openCase === null || openCase.status !== "ACTIVE") throw moderationConflict();
      if (product.status === "ARCHIVED") throw moderationConflict();
      if ((await tx.productImage.count({ where: { productId, status: "ACTIVE" } })) === 0) throw moderationConflict();

      await setModerationStatus(tx, productId, "RESTRICTED", "IN_REVIEW");
      await appendModerationEvent(tx, {
        productId,
        caseId: openCase.id,
        action: "RESUBMITTED",
        fromStatus: "RESTRICTED",
        toStatus: "IN_REVIEW",
        actorType: "SELLER",
        actorUserId: seller.userId,
        sellerNote: body.note ?? null,
      });
      return this.queries.sellerHistory(seller.userId, productId, tx);
    });
  }

  /** Shop `FOR SHARE`, then product `FOR UPDATE`; refuses an administrator's own shop (`403`). */
  private async lockForAdmin(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    productId: string,
  ): Promise<{ shop: LockedShop; product: LockedModerationProduct }> {
    const owner = await tx.product.findUnique({ where: { id: productId }, select: { shopId: true } });
    if (owner === null) throw productNotFound();
    const shop = await lockShopForShare(tx, owner.shopId);
    if (shop === null) throw productNotFound();
    const product = await lockProductForUpdate(tx, shop.id, productId);
    if (product === null) throw productNotFound();
    if (shop.ownerUserId === adminUserId) throw selfAdministration();
    return { shop, product };
  }

  private async lastOutcome(tx: Prisma.TransactionClient, productId: string): Promise<string | null> {
    const last = await tx.productModerationCase.findFirst({
      where: { productId, status: "CLOSED" },
      orderBy: [{ closedAt: "desc" }, { id: "desc" }],
      select: { outcome: true },
    });
    return last?.outcome ?? null;
  }

  private async applyAdminTransition(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    shop: LockedShop,
    product: LockedModerationProduct,
    openCase: LockedCase | null,
    transition: Transition,
    input: AdminProductActionInput,
  ): Promise<void> {
    const from = product.moderationStatus;
    await setModerationStatus(tx, product.id, from, transition.to);
    const caseId = await this.moveCase(tx, adminUserId, shop, product, openCase, transition);

    const sanction = input.action === "restore" ? null : input.body;
    const sellerMessage = input.action === "restore" ? (input.body.sellerMessage ?? null) : input.body.sellerMessage;
    const eventId = await appendModerationEvent(tx, {
      productId: product.id,
      caseId,
      action: transition.action,
      fromStatus: from,
      toStatus: transition.to,
      actorType: "ADMIN",
      actorUserId: adminUserId,
      sellerReasonCode: sanction?.sellerReasonCode ?? null,
      sellerMessage,
      internalReason: input.body.internalReason,
      internalNote: input.body.internalNote ?? null,
    });

    const notification: ProductModerationNotification = {
      sellerUserId: shop.ownerUserId,
      type: transition.notification,
      eventId,
      productId: product.id,
      productName: product.name,
      reasonCode: sanction?.sellerReasonCode ?? null,
      sellerMessage,
    };
    await (this.faults.recordNotification ?? recordProductModerationNotification)(tx, notification);
  }

  /**
   * The case after a transition: the existing non-closed case moves; a
   * restriction or removal without one opens an `ADMIN_INSPECTION` case.
   */
  private async moveCase(
    tx: Prisma.TransactionClient,
    adminUserId: string,
    shop: LockedShop,
    product: LockedModerationProduct,
    openCase: LockedCase | null,
    transition: Transition,
  ): Promise<string> {
    const closing = transition.caseStatus === "CLOSED" ? { closedAt: new Date(), closedByUserId: adminUserId, outcome: transition.outcome ?? null } : {};
    if (openCase === null) {
      // T6 needs an `ACTIVE` case: a restricted product always has one.
      if (transition.action === "RESTORED" || transition.action === "CORRECTION_REQUESTED") throw moderationConflict();
      const created = await tx.productModerationCase.create({
        data: {
          productId: product.id,
          shopId: shop.id,
          status: transition.caseStatus,
          source: "ADMIN_INSPECTION",
          openedByUserId: adminUserId,
          ...closing,
        },
        select: { id: true },
      });
      return created.id;
    }
    const updated = await tx.productModerationCase.updateMany({
      where: { id: openCase.id, status: openCase.status },
      data: { status: transition.caseStatus, ...closing },
    });
    if (updated.count !== 1) throw moderationConflict();
    return openCase.id;
  }
}
