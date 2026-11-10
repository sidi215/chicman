import type {
  SellerRejectionReason,
  ShopOrderCancelledPayload,
  ShopOrderConfirmedPayload,
  ShopOrderExpiredPayload,
  ShopOrderPlacedPayload,
  ShopOrderReasonCode,
  ShopOrderRejectedPayload,
  ShopOrderResponseReminderPayload,
} from "@chicman/shared";

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

/** The shop order a lifecycle notification is about, with the snapshotted shop name. */
export interface ShopOrderNotificationSubject {
  shopOrderId: string;
  orderReference: string;
  shopName: string;
  customerUserId: string;
  sellerUserId: string;
}

const shopOrderResource = (shopOrderId: string) => ({ type: "SHOP_ORDER" as const, id: shopOrderId });

/** The seller confirmed: tells the customer (spec 15). Keyed by the status event. */
export async function recordShopOrderConfirmed(tx: Prisma.TransactionClient, subject: ShopOrderNotificationSubject, statusEventId: string): Promise<void> {
  const payload: ShopOrderConfirmedPayload = { orderReference: subject.orderReference, shopName: subject.shopName };
  await recordNotification(tx, {
    recipientUserId: subject.customerUserId,
    type: "SHOP_ORDER_CONFIRMED",
    payload: { ...payload },
    sourceId: statusEventId,
    resource: shopOrderResource(subject.shopOrderId),
  });
}

/** The seller rejected: tells the customer, with the reason code only. */
export async function recordShopOrderRejected(
  tx: Prisma.TransactionClient,
  subject: ShopOrderNotificationSubject,
  statusEventId: string,
  reasonCode: SellerRejectionReason,
): Promise<void> {
  const payload: ShopOrderRejectedPayload = { orderReference: subject.orderReference, shopName: subject.shopName, reasonCode };
  await recordNotification(tx, {
    recipientUserId: subject.customerUserId,
    type: "SHOP_ORDER_REJECTED",
    payload: { ...payload },
    sourceId: statusEventId,
    resource: shopOrderResource(subject.shopOrderId),
  });
}

/**
 * A cancellation tells the other party: the seller when the customer cancels,
 * the customer when the seller cancels, both for an administrator or a
 * suspension (spec 15). Codes only: never the customer's text or an
 * administrator's internal reason.
 */
export async function recordShopOrderCancelled(
  tx: Prisma.TransactionClient,
  subject: ShopOrderNotificationSubject,
  statusEventId: string,
  cancelledBy: ShopOrderCancelledPayload["cancelledBy"],
  reasonCode: ShopOrderReasonCode | null,
): Promise<void> {
  const payload: ShopOrderCancelledPayload = { orderReference: subject.orderReference, shopName: subject.shopName, cancelledBy, reasonCode };
  const recipients =
    cancelledBy === "CUSTOMER" ? [subject.sellerUserId] : cancelledBy === "SELLER" ? [subject.customerUserId] : [subject.customerUserId, subject.sellerUserId];
  for (const recipientUserId of recipients) {
    await recordNotification(tx, {
      recipientUserId,
      type: "SHOP_ORDER_CANCELLED",
      payload: { ...payload },
      sourceId: statusEventId,
      resource: shopOrderResource(subject.shopOrderId),
    });
  }
}

/** The seller did not answer in time: tells the customer and the seller. */
export async function recordShopOrderExpired(tx: Prisma.TransactionClient, subject: ShopOrderNotificationSubject, statusEventId: string): Promise<void> {
  const payload: ShopOrderExpiredPayload = { orderReference: subject.orderReference, shopName: subject.shopName };
  for (const recipientUserId of [subject.customerUserId, subject.sellerUserId]) {
    await recordNotification(tx, {
      recipientUserId,
      type: "SHOP_ORDER_EXPIRED",
      payload: { ...payload },
      sourceId: statusEventId,
      resource: shopOrderResource(subject.shopOrderId),
    });
  }
}

/**
 * The one reminder halfway to the deadline (D7). Keyed by the shop order, so a
 * repeated or concurrent job run can never record a second one.
 */
export async function recordShopOrderResponseReminder(
  tx: Prisma.TransactionClient,
  input: { shopOrderId: string; orderReference: string; sellerUserId: string; respondBy: Date },
): Promise<void> {
  const payload: ShopOrderResponseReminderPayload = { orderReference: input.orderReference, respondBy: input.respondBy.toISOString() };
  await recordNotification(tx, {
    recipientUserId: input.sellerUserId,
    type: "SHOP_ORDER_RESPONSE_REMINDER",
    payload: { ...payload },
    sourceId: input.shopOrderId,
    resource: shopOrderResource(input.shopOrderId),
  });
}
