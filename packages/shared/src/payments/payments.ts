import { z } from "zod";

import type { CustomerPayment } from "../orders/orders.js";
import { DECISION_REASON_MAX_LENGTH, DECISION_REASON_MIN_LENGTH } from "../shops/constants.js";
import { plainText } from "../shops/schemas.js";

/**
 * Cash on delivery (spec 13): the seller's view of a payment, the
 * administrator's correction notes, and the seller's collection summary.
 * Amounts are MRU decimal strings with two decimals.
 */

// ---------------------------------------------------------------------------
// Seller view (section 10): the customer's view plus collection time and amount
// ---------------------------------------------------------------------------

export interface SellerPayment extends CustomerPayment {
  /** Always the amount due when `COLLECTED` (section 6); otherwise `null`. */
  collectedAmount: string | null;
  collectedAt: string | null;
}

// ---------------------------------------------------------------------------
// Administrator correction notes (section 7)
// ---------------------------------------------------------------------------

/** A correction note's reason: plain text, 10–500 characters, as for shop decisions. */
export const PAYMENT_NOTE_REASON_MIN_LENGTH = DECISION_REASON_MIN_LENGTH;
export const PAYMENT_NOTE_REASON_MAX_LENGTH = DECISION_REASON_MAX_LENGTH;

/**
 * `POST /admin/orders/:shopOrderId/payment/notes`. Appends an `ADMIN_NOTE`
 * event; never changes a status or an amount. Internal: never in customer or
 * seller responses or notifications.
 */
export const paymentNoteSchema = z.strictObject({
  reason: plainText(PAYMENT_NOTE_REASON_MIN_LENGTH, PAYMENT_NOTE_REASON_MAX_LENGTH),
});
export type PaymentNoteInput = z.output<typeof paymentNoteSchema>;

// ---------------------------------------------------------------------------
// Seller collection summary (section 9)
// ---------------------------------------------------------------------------

/** The longest period of a summary, in days, both ends included. */
export const PAYMENT_SUMMARY_MAX_DAYS = 366;

const DAY_MS = 86_400_000;

/** Days from `from` to `to`, both included. Both are valid `YYYY-MM-DD` dates. */
export function periodDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

/**
 * `GET /sellers/me/payments/summary?from=&to=`: UTC days, both included, both
 * required, `from` not after `to`, at most 366 days. The period selects the
 * shop orders placed in it.
 */
export const sellerPaymentSummaryQuerySchema = z
  .strictObject({ from: z.iso.date(), to: z.iso.date() })
  .refine((value) => value.from <= value.to, { message: "from must not be after to" })
  .refine((value) => periodDays(value.from, value.to) <= PAYMENT_SUMMARY_MAX_DAYS, { message: "the period is at most 366 days" });
export type SellerPaymentSummaryQuery = z.output<typeof sellerPaymentSummaryQuerySchema>;

export interface PaymentCountAndTotal {
  count: number;
  /** Sum of the amounts, `"0.00"` when none. */
  total: string;
}

/**
 * The seller's payments for the shop orders placed in the period, by status.
 * The four counts partition those payments. `collected.total` is the sum of
 * the collected amounts, which always equal the amounts due (section 6);
 * `pending.total` is the amount still to collect. No ledger, settlement,
 * commission, or payout.
 */
export interface SellerPaymentSummary {
  from: string;
  to: string;
  collected: PaymentCountAndTotal;
  pending: PaymentCountAndTotal;
  failed: { count: number };
  cancelled: { count: number };
}
