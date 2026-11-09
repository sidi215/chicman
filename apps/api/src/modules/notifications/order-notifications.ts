import type { ShopOrderPlacedPayload } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { recordNotification } from "./notifications.js";

export interface ShopOrderPlaced {
  sellerUserId: string;
  orderReference: string;
  shopOrderId: string;
  itemsCount: number;
  total: Prisma.Decimal;
  respondBy: Date;
}

/** The allowlisted payload of `SHOP_ORDER_PLACED` (spec 15, section 5): no customer data. */
export function shopOrderPlacedPayload(input: ShopOrderPlaced): ShopOrderPlacedPayload {
  return {
    orderReference: input.orderReference,
    shopOrderId: input.shopOrderId,
    itemsCount: input.itemsCount,
    total: input.total.toFixed(2),
    respondBy: input.respondBy.toISOString(),
  };
}

/** Tells the seller a new shop order awaits their answer. Recorded by checkout (spec 10). */
export async function recordShopOrderPlaced(tx: Prisma.TransactionClient, input: ShopOrderPlaced): Promise<void> {
  await recordNotification(tx, {
    recipientUserId: input.sellerUserId,
    type: "SHOP_ORDER_PLACED",
    payload: { ...shopOrderPlacedPayload(input) },
    sourceId: input.shopOrderId,
    resource: { type: "SHOP_ORDER", id: input.shopOrderId },
  });
}
