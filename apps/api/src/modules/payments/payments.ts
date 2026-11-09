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
