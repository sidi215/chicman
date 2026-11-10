import type { AdminPaymentEvent, CustomerPayment, SellerPayment } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";

/**
 * Payment views (spec 13, section 10), one per viewer. The customer sees the
 * method, the amount due, and the status; the seller also the collection time
 * and amount; the administrator everything, including events and notes (spec
 * 11's admin shop order view). Nothing internal reaches a customer or seller.
 */

export const customerPaymentSelect = { method: true, amountDue: true, status: true } satisfies Prisma.PaymentSelect;

type CustomerPaymentRow = Prisma.PaymentGetPayload<{ select: typeof customerPaymentSelect }>;

export function customerPaymentView(row: CustomerPaymentRow): CustomerPayment {
  return { method: row.method, amountDue: row.amountDue.toFixed(2), status: row.status };
}

export const sellerPaymentSelect = { ...customerPaymentSelect, collectedAmount: true, collectedAt: true } satisfies Prisma.PaymentSelect;

type SellerPaymentRow = Prisma.PaymentGetPayload<{ select: typeof sellerPaymentSelect }>;

export function sellerPaymentView(row: SellerPaymentRow): SellerPayment {
  return {
    ...customerPaymentView(row),
    collectedAmount: row.collectedAmount?.toFixed(2) ?? null,
    collectedAt: row.collectedAt?.toISOString() ?? null,
  };
}

export function adminPaymentEventView(event: Prisma.PaymentEventGetPayload<object>): AdminPaymentEvent {
  return {
    id: event.id,
    type: event.type,
    amount: event.amount?.toFixed(2) ?? null,
    actorType: event.actorType,
    actorUserId: event.actorUserId,
    reason: event.reason,
    createdAt: event.createdAt.toISOString(),
  };
}
