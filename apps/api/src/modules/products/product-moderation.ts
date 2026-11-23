import type { ProductModerationReason, ProductModerationStatus, SellerProductModeration } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";

/** The moderation columns a seller view needs. */
export interface ModerationColumns {
  id: string;
  moderationStatus: ProductModerationStatus;
  moderationUpdatedAt: Date | null;
}

/** Actions whose seller reason and message explain the current non-`CLEAR` state. */
const SELLER_REASON_ACTIONS = ["RESTRICTED", "CORRECTION_REQUESTED", "REMOVED"] as const;

/**
 * The seller's view of each product's moderation (spec 19, section 6): the
 * state and, while it is not `CLEAR`, the administrator's latest seller reason
 * and message. Never an internal reason, a note, a report, or an administrator.
 */
export async function sellerModerationOf(
  db: Prisma.TransactionClient,
  products: readonly ModerationColumns[],
): Promise<Map<string, SellerProductModeration>> {
  const moderated = products.filter((product) => product.moderationStatus !== "CLEAR").map((product) => product.id);
  const latest = new Map<string, { sellerReasonCode: ProductModerationReason | null; sellerMessage: string | null }>();
  if (moderated.length > 0) {
    const events = await db.productModerationEvent.findMany({
      where: { productId: { in: moderated }, action: { in: [...SELLER_REASON_ACTIONS] } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      distinct: ["productId"],
      select: { productId: true, sellerReasonCode: true, sellerMessage: true },
    });
    for (const event of events) latest.set(event.productId, event);
  }
  return new Map(
    products.map((product) => {
      const reason = product.moderationStatus === "CLEAR" ? undefined : latest.get(product.id);
      return [
        product.id,
        {
          status: product.moderationStatus,
          reasonCode: reason?.sellerReasonCode ?? null,
          message: reason?.sellerMessage ?? null,
          updatedAt: product.moderationUpdatedAt?.toISOString() ?? null,
        },
      ];
    }),
  );
}

export const CLEAR_MODERATION: SellerProductModeration = { status: "CLEAR", reasonCode: null, message: null, updatedAt: null };
