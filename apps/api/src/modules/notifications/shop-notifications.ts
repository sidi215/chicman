import type { ShopNotificationType, ShopStatus } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Owner notifications for the six administrative shop decisions (spec 06,
 * Owner notifications). The record is written inside the decision
 * transaction, so it exists exactly when the decision commits; delivery
 * channels belong to the notifications module and its workers.
 *
 * The payload is built field by field from this allowlist, never from the
 * decision record: it never carries internal reasons, internal notes,
 * administrator identities, audit metadata, or the application-rejection
 * reason (the owner reads that in the seller dashboard).
 */
export interface ShopDecisionNotificationPayload {
  shopName: string;
  /** Resulting shop status (the shop status is unchanged by change requests). */
  shopStatus: ShopStatus;
  /** Change-request outcome, for change-request decisions only. */
  changeRequestOutcome?: "APPROVED" | "REJECTED";
  /** Affected field names, for change-request decisions only. */
  fields?: ("shopName" | "city")[];
  decidedAt: string;
}

export interface ShopDecisionNotification {
  recipientUserId: string;
  type: ShopNotificationType;
  shopName: string;
  shopStatus: ShopStatus;
  changeRequestOutcome?: "APPROVED" | "REJECTED";
  fields?: ("shopName" | "city")[];
  decidedAt: Date;
}

/** Builds the allowlisted template payload. */
export function shopDecisionPayload(input: ShopDecisionNotification): ShopDecisionNotificationPayload {
  const payload: ShopDecisionNotificationPayload = {
    shopName: input.shopName,
    shopStatus: input.shopStatus,
    decidedAt: input.decidedAt.toISOString(),
  };
  if (input.changeRequestOutcome !== undefined) payload.changeRequestOutcome = input.changeRequestOutcome;
  if (input.fields !== undefined) payload.fields = [...input.fields];
  return payload;
}

/** Records one owner notification in the caller's transaction. */
export async function recordShopDecisionNotification(
  tx: Prisma.TransactionClient,
  input: ShopDecisionNotification,
): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.recipientUserId,
      type: input.type,
      payload: { ...shopDecisionPayload(input) },
    },
  });
}
