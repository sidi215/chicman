import { z } from "zod";

import type { AdminDeliveryAttempt, SellerDeliveryRecord } from "../delivery/delivery.js";
import type { SellerPayment } from "../payments/payments.js";
import { internalDecisionSchema, plainText } from "../shops/schemas.js";
import type {
  CustomerOrderItem,
  CustomerPayment,
  DeliveryStatus,
  OrderActorType,
  OrderDeliverySnapshot,
  PaymentStatus,
  ShopOrderCanceller,
  ShopOrderLabel,
  ShopOrderStatus,
} from "./orders.js";

/**
 * The shop order lifecycle (spec 11): reason codes, request bodies, list
 * queries, the seller and administrator views, and the notification
 * payloads. Reasons are codes, shown translated; free text never reaches a
 * customer and never goes into a notification.
 */

/** A seller's rejection of a `PENDING` shop order (D6). Required. */
export const SELLER_REJECTION_REASONS = ["OUT_OF_STOCK", "CANNOT_DELIVER_TO_AREA", "PRICE_ERROR", "OTHER"] as const;
export type SellerRejectionReason = (typeof SELLER_REJECTION_REASONS)[number];

/** A seller's cancellation of a `CONFIRMED` shop order (D6). Required. */
export const SELLER_CANCELLATION_REASONS = [...SELLER_REJECTION_REASONS, "CUSTOMER_REQUESTED"] as const;
export type SellerCancellationReason = (typeof SELLER_CANCELLATION_REASONS)[number];

/** A customer's cancellation of a `PENDING` shop order (S2-4). Optional; `OTHER` needs `reasonText`. */
export const CUSTOMER_CANCELLATION_REASONS = ["CHANGED_MIND", "ORDERED_BY_MISTAKE", "OTHER"] as const;
export type CustomerCancellationReason = (typeof CUSTOMER_CANCELLATION_REASONS)[number];

/** The system's cancellation at shop suspension (D8). */
export const SYSTEM_CANCELLATION_REASONS = ["SHOP_UNAVAILABLE"] as const;
export type SystemCancellationReason = (typeof SYSTEM_CANCELLATION_REASONS)[number];

/** Every reason code a shop order can carry. */
export type ShopOrderReasonCode = SellerCancellationReason | CustomerCancellationReason | SystemCancellationReason;

/** The customer's explanation with `OTHER`: plain text, 3–200 characters (implementation value). */
export const CUSTOMER_REASON_TEXT_MIN_LENGTH = 3;
export const CUSTOMER_REASON_TEXT_MAX_LENGTH = 200;

/**
 * `POST /customers/me/orders/:orderId/shop-orders/:shopOrderId/cancel`. The
 * body may be empty. `reasonText` is required with `OTHER` and refused otherwise.
 */
export const customerCancellationSchema = z
  .strictObject({
    reason: z.enum(CUSTOMER_CANCELLATION_REASONS).optional(),
    reasonText: plainText(CUSTOMER_REASON_TEXT_MIN_LENGTH, CUSTOMER_REASON_TEXT_MAX_LENGTH).optional(),
  })
  .refine((value) => (value.reason === "OTHER") === (value.reasonText !== undefined), {
    message: "reasonText is required with OTHER and refused otherwise",
  });
export type CustomerCancellationInput = z.output<typeof customerCancellationSchema>;

/** `POST /sellers/me/orders/:shopOrderId/confirm`: no body (an empty one is accepted). */
export const sellerConfirmationSchema = z.strictObject({});

/** `POST /sellers/me/orders/:shopOrderId/reject`. */
export const sellerRejectionSchema = z.strictObject({ reason: z.enum(SELLER_REJECTION_REASONS) });
export type SellerRejectionInput = z.output<typeof sellerRejectionSchema>;

/** `POST /sellers/me/orders/:shopOrderId/cancel`. */
export const sellerCancellationSchema = z.strictObject({ reason: z.enum(SELLER_CANCELLATION_REASONS) });
export type SellerCancellationInput = z.output<typeof sellerCancellationSchema>;

/**
 * `POST /admin/orders/:shopOrderId/cancel`: a required internal reason
 * (10–500) and an optional internal note (1–1000), as for shop decisions.
 * Both stay internal: never in customer or seller responses or notifications.
 */
export const adminOrderCancellationSchema = internalDecisionSchema;
export type AdminOrderCancellationInput = z.output<typeof adminOrderCancellationSchema>;

export const ORDER_LIST_DEFAULT_PAGE_SIZE = 20;
export const ORDER_LIST_MAX_PAGE_SIZE = 50;

const page = z.coerce.number().int().min(1).max(1_000_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(ORDER_LIST_MAX_PAGE_SIZE).default(ORDER_LIST_DEFAULT_PAGE_SIZE);

/** `GET /customers/me/orders`: newest first. */
export const customerOrderListQuerySchema = z.strictObject({ page, pageSize });
export type CustomerOrderListQuery = z.output<typeof customerOrderListQuerySchema>;

const shopOrderStatus = z.enum(["PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED", "DELIVERED", "FAILED_DELIVERY"]);

/** `GET /sellers/me/orders`: newest first, optionally one status. */
export const sellerOrderListQuerySchema = z.strictObject({ status: shopOrderStatus.optional(), page, pageSize });
export type SellerOrderListQuery = z.output<typeof sellerOrderListQuerySchema>;

/** `GET /admin/orders`: `from` and `to` are UTC days (inclusive) of placement. */
export const adminOrderListQuerySchema = z
  .strictObject({
    status: shopOrderStatus.optional(),
    shopId: z.uuid().optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    page,
    pageSize,
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, { message: "from must not be after to" });
export type AdminOrderListQuery = z.output<typeof adminOrderListQuerySchema>;

// ---------------------------------------------------------------------------
// Customer list
// ---------------------------------------------------------------------------

export interface CustomerOrderListShopOrder {
  id: string;
  shopName: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
}

export interface CustomerOrderListItem {
  id: string;
  reference: string;
  createdAt: string;
  total: string;
  /** Units ordered. */
  itemsCount: number;
  shopOrders: CustomerOrderListShopOrder[];
}

export interface CustomerOrderListResponse {
  orders: CustomerOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
}

// ---------------------------------------------------------------------------
// Seller views (spec 11, section 10): staged delivery details
// ---------------------------------------------------------------------------

export interface SellerShopOrderListItem {
  id: string;
  orderReference: string;
  createdAt: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
  deliveryStatus: DeliveryStatus | null;
  respondBy: string;
  itemsCount: number;
  total: string;
  /** Only the area, at every stage of the list. */
  city: string;
  district: string;
}

export interface SellerShopOrderListResponse {
  shopOrders: SellerShopOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
}

/** Before confirmation the seller sees only the area (D11). */
export interface SellerLimitedDelivery {
  stage: "LIMITED";
  city: string;
  district: string;
}

/** From confirmation on, the full snapshot, including the pin and the phone. */
export interface SellerFullDelivery extends OrderDeliverySnapshot {
  stage: "FULL";
}

/**
 * The seller's view of a decision: the code and, for a customer's `OTHER`,
 * the customer's text (render it escaped). An administrator is only "Chicman":
 * the internal reason and note never appear.
 */
export interface SellerShopOrderDecision {
  cancelledBy: ShopOrderCanceller | null;
  reason: ShopOrderReasonCode | null;
  reasonText: string | null;
}

export interface SellerShopOrderActions {
  confirm: boolean;
  reject: boolean;
  cancel: boolean;
}

export interface SellerShopOrderDetail {
  id: string;
  orderReference: string;
  createdAt: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
  deliveryStatus: DeliveryStatus | null;
  respondBy: string;
  decidedAt: string | null;
  closedAt: string | null;
  decision: SellerShopOrderDecision;
  productsSubtotal: string;
  deliveryFee: string;
  total: string;
  items: CustomerOrderItem[];
  delivery: SellerLimitedDelivery | SellerFullDelivery;
  /** The customer's view plus collection time and amount (spec 13, section 10). */
  payment: SellerPayment;
  /** The delivery record with its attempts and actions (spec 12); `null` before confirmation. */
  deliveryRecord: SellerDeliveryRecord | null;
  /** Decided by the API from the status, the delivery, and the deadline. */
  actions: SellerShopOrderActions;
}

// ---------------------------------------------------------------------------
// Administrator views: everything, read-only, plus cancellation
// ---------------------------------------------------------------------------

export interface AdminShopOrderListItem {
  id: string;
  orderId: string;
  orderReference: string;
  createdAt: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
  deliveryStatus: DeliveryStatus | null;
  shop: { id: string; name: string };
  customerUserId: string;
  total: string;
  respondBy: string;
}

export interface AdminShopOrderListResponse {
  shopOrders: AdminShopOrderListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminStatusEvent {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  actorType: OrderActorType;
  actorUserId: string | null;
  reasonCode: string | null;
  reasonText: string | null;
  internalReason: string | null;
  internalNote: string | null;
  createdAt: string;
}

export interface AdminStockMovement {
  id: string;
  orderItemId: string;
  productId: string;
  variantId: string | null;
  quantity: number;
  type: "TAKEN" | "RETURNED";
  applied: boolean;
  skipReason: "VARIANT_REMOVED" | "VARIANT_STRUCTURE_CHANGED" | "ABOVE_MAXIMUM" | null;
  createdAt: string;
}

export interface AdminPaymentEvent {
  id: string;
  type: "CREATED" | "COLLECTED" | "FAILED" | "CANCELLED" | "ADMIN_NOTE";
  amount: string | null;
  actorType: OrderActorType;
  actorUserId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface AdminOrderItem extends CustomerOrderItem {
  variantId: string | null;
}

export interface AdminShopOrderDetail {
  id: string;
  orderId: string;
  orderReference: string;
  customerUserId: string;
  createdAt: string;
  updatedAt: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
  respondBy: string;
  remindAt: string;
  decidedAt: string | null;
  closedAt: string | null;
  decision: {
    cancelledBy: OrderActorType | null;
    reasonCode: string | null;
    reasonText: string | null;
    internalReason: string | null;
    internalNote: string | null;
  };
  shop: { id: string; name: string; contactPhone: string; whatsappPhone: string | null };
  productsSubtotal: string;
  deliveryFee: string;
  total: string;
  delivery: OrderDeliverySnapshot;
  items: AdminOrderItem[];
  payment: {
    method: CustomerPayment["method"];
    amountDue: string;
    status: PaymentStatus;
    collectedAmount: string | null;
    collectedAt: string | null;
    events: AdminPaymentEvent[];
  };
  deliveryRecord: {
    status: DeliveryStatus;
    createdAt: string;
    autoCloseAt: string | null;
    closedAt: string | null;
    attempts: AdminDeliveryAttempt[];
    events: AdminStatusEvent[];
  } | null;
  history: AdminStatusEvent[];
  stockMovements: AdminStockMovement[];
  /** Decided by the API: before dispatch and not a shop this administrator owns. */
  canCancel: boolean;
}

// ---------------------------------------------------------------------------
// Notification payloads (spec 15, section 5): codes and names only
// ---------------------------------------------------------------------------

export interface ShopOrderConfirmedPayload {
  orderReference: string;
  shopName: string;
}

export interface ShopOrderRejectedPayload {
  orderReference: string;
  shopName: string;
  reasonCode: SellerRejectionReason;
}

/** `cancelledBy` is "Chicman" for an administrator and for a suspension; never the admin's internal reason. */
export interface ShopOrderCancelledPayload {
  orderReference: string;
  shopName: string;
  cancelledBy: "CUSTOMER" | "SELLER" | "CHICMAN";
  reasonCode: ShopOrderReasonCode | null;
}

export interface ShopOrderExpiredPayload {
  orderReference: string;
  shopName: string;
}

export interface ShopOrderResponseReminderPayload {
  orderReference: string;
  respondBy: string;
}
