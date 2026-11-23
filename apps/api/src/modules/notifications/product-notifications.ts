import type { ProductModerationNotificationPayload, ProductModerationNotificationType, ProductModerationReason } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { recordNotification } from "./notifications.js";

/**
 * Seller notifications of product moderation (spec 19, section 6), recorded in
 * the moderation transaction: if recording fails, the action rolls back.
 *
 * The payload is built field by field from this allowlist: never a report, a
 * reporter, an internal reason or note, or the administrator's identity.
 */
export interface ProductModerationNotification {
  /** The shop owner. */
  sellerUserId: string;
  type: ProductModerationNotificationType;
  /** The moderation event: the key is `<type>:<event ID>:<seller>`. */
  eventId: string;
  productId: string;
  productName: string;
  reasonCode: ProductModerationReason | null;
  sellerMessage: string | null;
}

export function productModerationPayload(input: ProductModerationNotification): ProductModerationNotificationPayload {
  return {
    productId: input.productId,
    productName: input.productName,
    reasonCode: input.reasonCode,
    sellerMessage: input.sellerMessage,
  };
}

export async function recordProductModerationNotification(tx: Prisma.TransactionClient, input: ProductModerationNotification): Promise<void> {
  await recordNotification(tx, {
    recipientUserId: input.sellerUserId,
    type: input.type,
    payload: { ...productModerationPayload(input) },
    sourceId: input.eventId,
    resource: { type: "PRODUCT", id: input.productId },
  });
}
