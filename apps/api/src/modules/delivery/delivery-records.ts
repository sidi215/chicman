import type {
  AdminDeliveryAttempt,
  CustomerDeliveryProgress,
  DeliveryStatus,
  SellerDeliveryActions,
  SellerDeliveryAttempt,
  SellerDeliveryRecord,
  ShopStatus,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { isDeliveryInProgress } from "./delivery.js";

/**
 * Views of the delivery record and its attempts (spec 12, section 9), used by
 * the order views (spec 11) and the seller delivery views. Built field by
 * field: the customer's selection holds no actor, deadline, or other
 * seller-only column at all.
 */

export const ATTEMPT_ORDER = { number: "asc" } satisfies Prisma.DeliveryAttemptOrderByWithRelationInput;

/** The attempt columns a customer may see: times, outcomes, and reasons, never actors. */
export const customerDeliverySelect = {
  attempts: { orderBy: ATTEMPT_ORDER, select: { number: true, dispatchedAt: true, outcome: true, failureReason: true, outcomeAt: true } },
} satisfies Prisma.DeliverySelect;

type CustomerDeliveryRow = Prisma.DeliveryGetPayload<{ select: typeof customerDeliverySelect }>;

export function customerDeliveryProgress(row: CustomerDeliveryRow): CustomerDeliveryProgress {
  const current = row.attempts.find((attempt) => attempt.outcome === null) ?? null;
  const delivered = row.attempts.find((attempt) => attempt.outcome === "DELIVERED") ?? null;
  return {
    attemptsCount: row.attempts.length,
    currentAttemptDispatchedAt: current?.dispatchedAt.toISOString() ?? null,
    failures: row.attempts.flatMap((attempt) =>
      attempt.outcome === "FAILED" && attempt.failureReason !== null && attempt.outcomeAt !== null
        ? [{ attemptNumber: attempt.number, reason: attempt.failureReason, failedAt: attempt.outcomeAt.toISOString() }]
        : [],
    ),
    deliveredAt: delivered?.outcomeAt?.toISOString() ?? null,
  };
}

/** The delivery record as its seller sees it. */
export const sellerDeliveryRecordSelect = {
  status: true,
  autoCloseAt: true,
  closedAt: true,
  attempts: { orderBy: ATTEMPT_ORDER, select: { number: true, dispatchedAt: true, outcome: true, failureReason: true, outcomeAt: true } },
} satisfies Prisma.DeliverySelect;

type SellerDeliveryRecordRow = Prisma.DeliveryGetPayload<{ select: typeof sellerDeliveryRecordSelect }>;

/**
 * What the seller may do next (sections 4 and 8). An approved shop has every
 * operation; a suspended shop only finishes a delivery under way and cannot
 * retry. Any other shop status: nothing.
 */
export function sellerDeliveryActions(delivery: { status: DeliveryStatus; closedAt: Date | null }, shopStatus: ShopStatus): SellerDeliveryActions {
  const approved = shopStatus === "APPROVED";
  const inProgressAllowed = approved || (shopStatus === "SUSPENDED" && isDeliveryInProgress(delivery));
  const openFailure = delivery.status === "FAILED" && delivery.closedAt === null;
  return {
    ready: approved && delivery.status === "PENDING",
    dispatch: approved && (delivery.status === "PENDING" || delivery.status === "ASSIGNED" || openFailure),
    delivered: inProgressAllowed && delivery.status === "OUT_FOR_DELIVERY",
    fail: inProgressAllowed && delivery.status === "OUT_FOR_DELIVERY",
    close: inProgressAllowed && openFailure,
  };
}

const attemptView = (attempt: SellerDeliveryRecordRow["attempts"][number]): SellerDeliveryAttempt => ({
  number: attempt.number,
  dispatchedAt: attempt.dispatchedAt.toISOString(),
  outcome: attempt.outcome,
  failureReason: attempt.failureReason,
  outcomeAt: attempt.outcomeAt?.toISOString() ?? null,
});

export function sellerDeliveryRecordView(row: SellerDeliveryRecordRow, shopStatus: ShopStatus): SellerDeliveryRecord {
  return {
    status: row.status,
    autoCloseAt: row.autoCloseAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    attempts: row.attempts.map(attemptView),
    actions: sellerDeliveryActions(row, shopStatus),
  };
}

export function adminAttemptView(attempt: {
  id: string;
  number: number;
  dispatchedAt: Date;
  dispatchedByUserId: string;
  outcome: SellerDeliveryAttempt["outcome"];
  failureReason: SellerDeliveryAttempt["failureReason"];
  outcomeAt: Date | null;
  outcomeByUserId: string | null;
}): AdminDeliveryAttempt {
  return {
    id: attempt.id,
    number: attempt.number,
    dispatchedAt: attempt.dispatchedAt.toISOString(),
    dispatchedByUserId: attempt.dispatchedByUserId,
    outcome: attempt.outcome,
    failureReason: attempt.failureReason,
    outcomeAt: attempt.outcomeAt?.toISOString() ?? null,
    outcomeByUserId: attempt.outcomeByUserId,
  };
}
