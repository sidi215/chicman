import type { Prisma } from "../../generated/prisma/client.js";

export interface PaymentCreation {
  shopOrderId: string;
  /** The shop order's products subtotal plus its delivery fee snapshot (D9). */
  amountDue: Prisma.Decimal;
  /** The customer whose placement creates the obligation. */
  customerUserId: string;
}

/**
 * Creates the shop order's cash-on-delivery payment, `PENDING`, with its
 * `CREATED` event (spec 13). Runs inside the placement transaction (spec 10),
 * the only caller. The amount is never recalculated afterwards. One payment
 * per shop order is enforced by a unique key.
 */
export async function createPayment(tx: Prisma.TransactionClient, input: PaymentCreation): Promise<void> {
  await tx.payment.create({
    data: {
      shopOrderId: input.shopOrderId,
      method: "CASH_ON_DELIVERY",
      amountDue: input.amountDue,
      status: "PENDING",
      events: { create: { type: "CREATED", amount: input.amountDue, actorType: "CUSTOMER", actorUserId: input.customerUserId } },
    },
  });
}

export interface PaymentClosure {
  shopOrderId: string;
  actorType: "CUSTOMER" | "SELLER" | "ADMIN" | "SYSTEM";
  actorUserId: string | null;
  at: Date;
}

/** `PENDING` → `to`, with its event. A final payment never changes (spec 13): `false`, nothing written. */
async function closePayment(tx: Prisma.TransactionClient, to: "CANCELLED" | "FAILED", input: PaymentClosure): Promise<boolean> {
  const payment = await tx.payment.findUnique({ where: { shopOrderId: input.shopOrderId }, select: { id: true } });
  if (payment === null) return false;
  const updated = await tx.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: to, updatedAt: input.at } });
  if (updated.count !== 1) return false;
  await tx.paymentEvent.create({
    data: { paymentId: payment.id, type: to, actorType: input.actorType, actorUserId: input.actorUserId, createdAt: input.at },
  });
  return true;
}

/**
 * The shop order became `REJECTED`, `CANCELLED`, or `EXPIRED`, so no delivery
 * was attempted (spec 13, section 5). Runs in the caller's transaction.
 */
export function markPaymentCancelled(tx: Prisma.TransactionClient, input: PaymentClosure): Promise<boolean> {
  return closePayment(tx, "CANCELLED", input);
}

/** The delivery was closed as undeliverable: shop order `FAILED_DELIVERY` (spec 13, section 5). */
export function markPaymentFailed(tx: Prisma.TransactionClient, input: PaymentClosure): Promise<boolean> {
  return closePayment(tx, "FAILED", input);
}

export interface PaymentCollection {
  shopOrderId: string;
  /** The amount the seller was shown and confirmed: a precondition only (spec 13, section 6). */
  shownAmount: string;
  sellerUserId: string;
  at: Date;
}

export type CollectionResult =
  | { kind: "collected"; amount: Prisma.Decimal }
  /** The shown amount is not the amount due: nothing written. */
  | { kind: "amountMismatch" }
  /** The payment is already final (or missing): nothing written. */
  | { kind: "notPending" };

/**
 * `PENDING` → `COLLECTED` (spec 13, section 6), called only by spec 12's
 * "delivered, cash received" action, in its transaction. The exact amount
 * due is collected: the stored amount always comes from the payment record,
 * never from the request. The conditional update from `PENDING` refuses a
 * second collection.
 */
export async function collectPayment(tx: Prisma.TransactionClient, input: PaymentCollection): Promise<CollectionResult> {
  const payment = await tx.payment.findUnique({ where: { shopOrderId: input.shopOrderId }, select: { id: true, amountDue: true, status: true } });
  if (payment === null || payment.status !== "PENDING") return { kind: "notPending" };
  if (!payment.amountDue.equals(input.shownAmount)) return { kind: "amountMismatch" };
  const updated = await tx.payment.updateMany({
    where: { id: payment.id, status: "PENDING" },
    data: { status: "COLLECTED", collectedAmount: payment.amountDue, collectedAt: input.at, collectedByUserId: input.sellerUserId, updatedAt: input.at },
  });
  if (updated.count !== 1) return { kind: "notPending" };
  await tx.paymentEvent.create({
    data: { paymentId: payment.id, type: "COLLECTED", amount: payment.amountDue, actorType: "SELLER", actorUserId: input.sellerUserId, createdAt: input.at },
  });
  return { kind: "collected", amount: payment.amountDue };
}
