import { z } from "zod";

import { moneyAmountSchema } from "../money.js";
import type { SellerPayment } from "../payments/payments.js";
import type { CustomerOrderItem, DeliveryStatus, OrderDeliverySnapshot, ShopOrderLabel, ShopOrderStatus } from "../orders/orders.js";

/**
 * Delivery management (spec 12, D4, D5, D8, D9): seller-managed delivery of
 * each confirmed shop order, its attempts, failure reasons, closure, and the
 * "delivered, cash received" action. Reasons are codes, shown translated.
 */

/** Fixed list of failure reasons (D5). Required on every failed attempt; no free text. */
export const DELIVERY_FAILURE_REASONS = [
  "CUSTOMER_UNREACHABLE",
  "CUSTOMER_ABSENT",
  "CUSTOMER_REFUSED",
  "ADDRESS_NOT_FOUND",
  "CUSTOMER_COULD_NOT_PAY",
  "OTHER",
] as const;
export type DeliveryFailureReason = (typeof DELIVERY_FAILURE_REASONS)[number];

/** An attempt's outcome; `null` while the attempt is in progress. */
export const DELIVERY_ATTEMPT_OUTCOMES = ["DELIVERED", "FAILED"] as const;
export type DeliveryAttemptOutcome = (typeof DELIVERY_ATTEMPT_OUTCOMES)[number];

/** The period after which an open failure is closed automatically (D5). Configuration default. */
export const DEFAULT_DELIVERY_FAILED_AUTO_CLOSE_DAYS = 7;

// ---------------------------------------------------------------------------
// Request bodies (strict: any other field is 400)
// ---------------------------------------------------------------------------

/** `ready`, `dispatch`, and `close` take no body; an empty object is accepted. */
export const deliveryEmptyBodySchema = z.strictObject({});

/**
 * "Delivered, cash received". `amount` is the amount the seller was shown, a
 * precondition only (spec 13, section 6): the stored amount always comes from
 * the payment record. Strings only.
 */
export const deliveryDeliveredSchema = z.strictObject({ amount: moneyAmountSchema });
export type DeliveryDeliveredInput = z.output<typeof deliveryDeliveredSchema>;

export const deliveryFailSchema = z.strictObject({ reason: z.enum(DELIVERY_FAILURE_REASONS) });
export type DeliveryFailInput = z.output<typeof deliveryFailSchema>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * What the customer sees of the delivery (spec 12, section 9), beside the
 * label: the current attempt's dispatch time, the number of attempts, each
 * failure reason (translated by the client), and the delivered time. Never
 * actors, deadlines, or anything else of the seller's.
 */
export interface CustomerDeliveryProgress {
  attemptsCount: number;
  /** The dispatch time of the attempt in progress; `null` when none is. */
  currentAttemptDispatchedAt: string | null;
  failures: { attemptNumber: number; reason: DeliveryFailureReason; failedAt: string }[];
  deliveredAt: string | null;
}

export interface SellerDeliveryAttempt {
  number: number;
  dispatchedAt: string;
  outcome: DeliveryAttemptOutcome | null;
  failureReason: DeliveryFailureReason | null;
  outcomeAt: string | null;
}

/** Decided by the API from the delivery status and the shop status. */
export interface SellerDeliveryActions {
  ready: boolean;
  dispatch: boolean;
  delivered: boolean;
  fail: boolean;
  close: boolean;
}

/** The delivery record as the seller sees it on their shop order. */
export interface SellerDeliveryRecord {
  status: DeliveryStatus;
  /** An open failure is closed automatically at this time (D5). */
  autoCloseAt: string | null;
  /** Set when a failure was closed as undeliverable (final). */
  closedAt: string | null;
  attempts: SellerDeliveryAttempt[];
  actions: SellerDeliveryActions;
}

/**
 * One delivery a seller must finish, or the result of a delivery action: what
 * the owner of a suspended shop may see (D8), with the full delivery snapshot.
 */
export interface SellerDelivery {
  shopOrderId: string;
  orderReference: string;
  shopOrderStatus: ShopOrderStatus;
  label: ShopOrderLabel;
  productsSubtotal: string;
  deliveryFee: string;
  total: string;
  /** What "delivered, cash received" must confirm, and its collection (spec 13). */
  payment: SellerPayment;
  delivery: OrderDeliverySnapshot;
  items: CustomerOrderItem[];
  record: SellerDeliveryRecord;
}

export interface SellerInProgressDeliveriesResponse {
  deliveries: SellerDelivery[];
}

/** The administrator's view of an attempt: everything, including actors. */
export interface AdminDeliveryAttempt extends SellerDeliveryAttempt {
  id: string;
  dispatchedByUserId: string;
  outcomeByUserId: string | null;
}

/**
 * Stable error codes of the delivery routes (spec 12) and the collection (spec 13).
 *
 * - `DELIVERY_STATUS_CONFLICT` (409): the delivery is not in a state that allows this action (or does not exist yet).
 * - `PAYMENT_AMOUNT_MISMATCH` (409): the amount the seller confirmed is not the amount due; nothing changed.
 */
export const DELIVERY_ERROR_CODES = {
  statusConflict: "DELIVERY_STATUS_CONFLICT",
  amountMismatch: "PAYMENT_AMOUNT_MISMATCH",
} as const;

// ---------------------------------------------------------------------------
// Notifications (spec 15, section 5): customer only, codes and names only
// ---------------------------------------------------------------------------

export const DELIVERY_NOTIFICATION_TYPES = ["DELIVERY_DISPATCHED", "DELIVERY_ATTEMPT_FAILED", "DELIVERY_COMPLETED", "DELIVERY_CLOSED_UNDELIVERABLE"] as const;
export type DeliveryNotificationType = (typeof DELIVERY_NOTIFICATION_TYPES)[number];

export interface DeliveryDispatchedPayload {
  orderReference: string;
  shopName: string;
  attemptNumber: number;
}

export interface DeliveryAttemptFailedPayload {
  orderReference: string;
  shopName: string;
  reasonCode: DeliveryFailureReason;
}

/** Covers "payment collected" (D9). */
export interface DeliveryCompletedPayload {
  orderReference: string;
  shopName: string;
  amountCollected: string;
}

/** Covers "payment failed" (D9). */
export interface DeliveryClosedUndeliverablePayload {
  orderReference: string;
  shopName: string;
}
