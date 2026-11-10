import type {
  DeliveryAttemptFailedPayload,
  DeliveryClosedUndeliverablePayload,
  DeliveryCompletedPayload,
  DeliveryDispatchedPayload,
  DeliveryFailureReason,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { recordNotification } from "./notifications.js";

/**
 * Delivery notifications (spec 15, section 5), recorded by spec 12 in the
 * transaction of the delivery change. Customer only; codes, names, and
 * figures only. Keys: the attempt for a dispatch or a failure, the delivery
 * status event for the delivered action and the closure.
 */

/** The shop order a delivery notification is about, with the snapshotted shop name. */
export interface DeliveryNotificationSubject {
  shopOrderId: string;
  orderReference: string;
  shopName: string;
  customerUserId: string;
}

const resourceOf = (subject: DeliveryNotificationSubject) => ({ type: "SHOP_ORDER" as const, id: subject.shopOrderId });

export async function recordDeliveryDispatched(tx: Prisma.TransactionClient, subject: DeliveryNotificationSubject, attempt: { id: string; number: number }): Promise<void> {
  const payload: DeliveryDispatchedPayload = { orderReference: subject.orderReference, shopName: subject.shopName, attemptNumber: attempt.number };
  await recordNotification(tx, { recipientUserId: subject.customerUserId, type: "DELIVERY_DISPATCHED", payload: { ...payload }, sourceId: attempt.id, resource: resourceOf(subject) });
}

export async function recordDeliveryAttemptFailed(
  tx: Prisma.TransactionClient,
  subject: DeliveryNotificationSubject,
  attemptId: string,
  reasonCode: DeliveryFailureReason,
): Promise<void> {
  const payload: DeliveryAttemptFailedPayload = { orderReference: subject.orderReference, shopName: subject.shopName, reasonCode };
  await recordNotification(tx, { recipientUserId: subject.customerUserId, type: "DELIVERY_ATTEMPT_FAILED", payload: { ...payload }, sourceId: attemptId, resource: resourceOf(subject) });
}

/** Delivered and paid: covers "payment collected" (D9). */
export async function recordDeliveryCompleted(
  tx: Prisma.TransactionClient,
  subject: DeliveryNotificationSubject,
  statusEventId: string,
  amountCollected: Prisma.Decimal,
): Promise<void> {
  const payload: DeliveryCompletedPayload = { orderReference: subject.orderReference, shopName: subject.shopName, amountCollected: amountCollected.toFixed(2) };
  await recordNotification(tx, { recipientUserId: subject.customerUserId, type: "DELIVERY_COMPLETED", payload: { ...payload }, sourceId: statusEventId, resource: resourceOf(subject) });
}

/** Closed as undeliverable: covers "payment failed" (D9). */
export async function recordDeliveryClosedUndeliverable(tx: Prisma.TransactionClient, subject: DeliveryNotificationSubject, statusEventId: string): Promise<void> {
  const payload: DeliveryClosedUndeliverablePayload = { orderReference: subject.orderReference, shopName: subject.shopName };
  await recordNotification(tx, {
    recipientUserId: subject.customerUserId,
    type: "DELIVERY_CLOSED_UNDELIVERABLE",
    payload: { ...payload },
    sourceId: statusEventId,
    resource: resourceOf(subject),
  });
}
