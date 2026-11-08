import {
  SHOP_ERROR_CODES,
  type ApplicationRejectionInput,
  type InternalDecisionInput,
  type ShopChangeRequestStatus,
  type ShopDecisionType,
  type ShopNotificationType,
  type ShopStatus,
} from "@chicman/shared";

import { HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { recordShopDecisionNotification } from "../notifications/shop-notifications.js";
import { diffFields, lockShopById, shopNotFound, shopStatusConflict } from "./shop.service.js";

export type ShopDecisionAction = "approve" | "reject" | "suspend" | "reinstate";

interface Transition {
  from: ShopStatus;
  to: ShopStatus;
  decisionType: ShopDecisionType;
  notification: ShopNotificationType;
}

/** The only administrator transitions (spec 06, Status lifecycle). */
export const SHOP_TRANSITIONS: Record<ShopDecisionAction, Transition> = {
  approve: { from: "PENDING", to: "APPROVED", decisionType: "APPLICATION_APPROVED", notification: "SHOP_APPLICATION_APPROVED" },
  reject: { from: "PENDING", to: "REJECTED", decisionType: "APPLICATION_REJECTED", notification: "SHOP_APPLICATION_REJECTED" },
  suspend: { from: "APPROVED", to: "SUSPENDED", decisionType: "SUSPENDED", notification: "SHOP_SUSPENDED" },
  reinstate: { from: "SUSPENDED", to: "APPROVED", decisionType: "REINSTATED", notification: "SHOP_REINSTATED" },
};

/** Validated decision body: `applicantReason` for `reject`, `internalReason` otherwise. */
export type ShopDecisionInput =
  | { action: "reject"; body: ApplicationRejectionInput }
  | { action: Exclude<ShopDecisionAction, "reject">; body: InternalDecisionInput };

export interface ShopDecisionResult {
  shopId: string;
  status: ShopStatus;
  decisionType: ShopDecisionType;
  decidedAt: string;
}

export interface ChangeRequestDecisionResult {
  id: string;
  shopId: string;
  status: ShopChangeRequestStatus;
  decidedAt: string;
}

export interface ShopLifecycleFaults {
  /** Runs inside the decision transaction, after every write. */
  beforeDecisionCommit?: () => void | Promise<void>;
}

const changeRequestNotFound = (): HttpError => notFound(SHOP_ERROR_CODES.changeRequestNotFound);

/**
 * An administrator cannot perform administrative decisions on a shop they
 * own, even when their account has the ADMIN role. Checked inside each
 * decision transaction, under the shop row lock, before any write.
 */
export function assertNotOwnShop(shop: { ownerUserId: string }, adminUserId: string): void {
  if (shop.ownerUserId === adminUserId) throw new HttpError(403, SHOP_ERROR_CODES.selfAdministrationForbidden);
}

/**
 * Administrator decisions (spec 06). Each runs in one transaction: a row
 * lock and the self-administration check (`403`, nothing written), a
 * conditional update on the expected current status, the audit record, the
 * `SELLER` grant (initial approval only), and the owner notification. A
 * concurrent action that changed the status first makes the update affect
 * no row → `409`, and nothing is written.
 */
export class ShopLifecycle {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly faults: ShopLifecycleFaults = {},
  ) {}

  async decide(shopId: string, adminUserId: string, input: ShopDecisionInput): Promise<ShopDecisionResult> {
    const transition = SHOP_TRANSITIONS[input.action];
    return this.prisma.$transaction(async (tx) => {
      // Lock first: the ownership check and the transition see the same row.
      const shop = await lockShopById(tx, shopId);
      if (shop === null) throw shopNotFound();
      assertNotOwnShop(shop, adminUserId);
      const updated = await tx.shop.updateMany({
        where: { id: shopId, status: transition.from },
        data: { status: transition.to },
      });
      if (updated.count !== 1) throw shopStatusConflict();

      const reasons =
        input.action === "reject"
          ? { applicantReason: input.body.applicantReason, internalReason: null }
          : { internalReason: input.body.internalReason, applicantReason: null };
      const event = await tx.shopStatusEvent.create({
        data: {
          shopId,
          fromStatus: transition.from,
          toStatus: transition.to,
          actorUserId: adminUserId,
          decisionType: transition.decisionType,
          ...reasons,
          internalNote: input.body.internalNote ?? null,
        },
        select: { createdAt: true },
      });

      // Initial approval only (including after a resubmission): grant SELLER
      // if absent (INSERT … ON CONFLICT DO NOTHING). Reinstatement retains
      // the existing role without a new grant; suspension revokes nothing.
      if (input.action === "approve") {
        await tx.userRole.createMany({ data: [{ userId: shop.ownerUserId, role: "SELLER" }], skipDuplicates: true });
      }

      await recordShopDecisionNotification(tx, {
        recipientUserId: shop.ownerUserId,
        type: transition.notification,
        shopName: shop.shopName,
        shopStatus: transition.to,
        decidedAt: event.createdAt,
      });
      await this.faults.beforeDecisionCommit?.();

      return {
        shopId,
        status: transition.to,
        decisionType: transition.decisionType,
        decidedAt: event.createdAt.toISOString(),
      };
    });
  }

  /**
   * Change-request decision. Approval copies the proposed values into
   * `Shop` and audits each changed field; rejection keeps the approved
   * values. Neither changes `Shop.status`. A racing decision → `409`.
   */
  async decideChangeRequest(
    shopId: string,
    requestId: string,
    adminUserId: string,
    outcome: "APPROVED" | "REJECTED",
    body: InternalDecisionInput,
  ): Promise<ChangeRequestDecisionResult> {
    return this.prisma.$transaction(async (tx) => {
      // Shop row first (same lock order as the owner's change-request
      // submission), then the ownership check, before any write.
      const shop = await lockShopById(tx, shopId);
      if (shop === null) throw changeRequestNotFound();
      assertNotOwnShop(shop, adminUserId);
      // After the lock: the time the decision applies, not when it started waiting.
      const decidedAt = new Date();
      const updated = await tx.shopChangeRequest.updateMany({
        where: { id: requestId, shopId, status: "PENDING" },
        data: {
          status: outcome,
          decidedByUserId: adminUserId,
          decidedAt,
          internalReason: body.internalReason,
          internalNote: body.internalNote ?? null,
        },
      });
      if (updated.count !== 1) {
        const exists = await tx.shopChangeRequest.findFirst({ where: { id: requestId, shopId }, select: { id: true } });
        throw exists === null ? changeRequestNotFound() : new HttpError(409, SHOP_ERROR_CODES.changeRequestConflict);
      }
      const request = await tx.shopChangeRequest.findUniqueOrThrow({
        where: { id: requestId },
        select: { proposedShopName: true, proposedCity: true },
      });

      const fields: ("shopName" | "city")[] = [];
      if (request.proposedShopName !== null) fields.push("shopName");
      if (request.proposedCity !== null) fields.push("city");

      let shopName = shop.shopName;
      if (outcome === "APPROVED") {
        const changes = diffFields(shop, {
          ...(request.proposedShopName === null ? {} : { shopName: request.proposedShopName }),
          ...(request.proposedCity === null ? {} : { city: request.proposedCity }),
        });
        if (changes.length > 0) {
          const data: Record<string, string | null> = {};
          for (const change of changes) data[change.field] = change.newValue;
          await tx.shop.update({ where: { id: shopId }, data });
          await tx.shopFieldChangeEvent.createMany({
            data: changes.map((change) => ({
              shopId,
              field: change.field,
              oldValue: change.oldValue,
              newValue: change.newValue,
              actorUserId: adminUserId,
              source: "CHANGE_REQUEST_APPROVED" as const,
            })),
          });
        }
        shopName = request.proposedShopName ?? shop.shopName;
      }

      await recordShopDecisionNotification(tx, {
        recipientUserId: shop.ownerUserId,
        type: outcome === "APPROVED" ? "SHOP_CHANGE_REQUEST_APPROVED" : "SHOP_CHANGE_REQUEST_REJECTED",
        shopName,
        shopStatus: shop.status,
        changeRequestOutcome: outcome,
        fields,
        decidedAt,
      });
      await this.faults.beforeDecisionCommit?.();

      return { id: requestId, shopId, status: outcome, decidedAt: decidedAt.toISOString() };
    });
  }
}
