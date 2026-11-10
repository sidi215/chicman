import type { AddressLocationSource } from "../addresses/address.js";
import type { CustomerDeliveryProgress } from "../delivery/delivery.js";
import type { SellerCancellationReason, SystemCancellationReason } from "./lifecycle.js";

/**
 * Orders (spec 11). One order per checkout, one shop order per shop in it, and
 * one order item per cart line. Only what checkout (spec 10) creates and shows
 * is defined so far; the lifecycle routes belong to spec 11.
 */

/** Shop order statuses (D4, D7). Delivery progress is not an order status (spec 12). */
export const SHOP_ORDER_STATUSES = ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED", "DELIVERED", "FAILED_DELIVERY"] as const;
export type ShopOrderStatus = (typeof SHOP_ORDER_STATUSES)[number];

/** Delivery statuses (spec 12, D4). */
export const DELIVERY_STATUSES = ["PENDING", "ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "CANCELLED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Who made a change, in order, payment, and stock history. */
export const ORDER_ACTOR_TYPES = ["CUSTOMER", "SELLER", "ADMIN", "SYSTEM"] as const;
export type OrderActorType = (typeof ORDER_ACTOR_TYPES)[number];

/** Cash on delivery is the only payment method (spec 13). */
export const PAYMENT_METHODS = ["CASH_ON_DELIVERY"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["PENDING", "COLLECTED", "FAILED", "CANCELLED"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * One label per shop order, derived from its status and its delivery's status
 * (spec 11, section 11). There is no combined label for a whole order. Clients
 * translate the key; web and mobile use the same map.
 */
export const SHOP_ORDER_LABELS = [
  "AWAITING_SHOP",
  "PREPARING",
  "READY_FOR_DELIVERY",
  "OUT_FOR_DELIVERY",
  "DELIVERY_FAILED_RETRY",
  "DELIVERED",
  "UNDELIVERABLE",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
] as const;
export type ShopOrderLabel = (typeof SHOP_ORDER_LABELS)[number];

export function shopOrderLabel(status: ShopOrderStatus, deliveryStatus: DeliveryStatus | null = null): ShopOrderLabel {
  switch (status) {
    case "PENDING":
      return "AWAITING_SHOP";
    case "CONFIRMED":
      if (deliveryStatus === "ASSIGNED") return "READY_FOR_DELIVERY";
      if (deliveryStatus === "OUT_FOR_DELIVERY") return "OUT_FOR_DELIVERY";
      if (deliveryStatus === "FAILED") return "DELIVERY_FAILED_RETRY";
      return "PREPARING";
    case "DELIVERED":
      return "DELIVERED";
    case "FAILED_DELIVERY":
      return "UNDELIVERABLE";
    case "REJECTED":
      return "REJECTED";
    case "CANCELLED":
      return "CANCELLED";
    case "EXPIRED":
      return "EXPIRED";
  }
}

/** The delivery details copied at placement (D11). The order never references the saved address. */
export interface OrderDeliverySnapshot {
  recipientName: string;
  /** Unverified contact data (spec 03): never labelled verified. */
  deliveryPhone: string;
  label: string | null;
  city: string;
  district: string;
  /** Serves as the delivery instructions. */
  landmark: string;
  latitude: number;
  longitude: number;
  locationSource: AddressLocationSource;
  accuracyMeters: number | null;
}

export interface CustomerOrderItem {
  id: string;
  productId: string;
  productName: string;
  size: string | null;
  color: string | null;
  /** The image at placement (S2-7); `null` shows the placeholder. */
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface CustomerPayment {
  method: PaymentMethod;
  amountDue: string;
  status: PaymentStatus;
}

/**
 * Who ended a shop order, as shown outside the administration: an
 * administrator is only ever "Chicman" (D6), never a person.
 */
export const SHOP_ORDER_CANCELLERS = ["CUSTOMER", "SELLER", "CHICMAN", "SYSTEM"] as const;
export type ShopOrderCanceller = (typeof SHOP_ORDER_CANCELLERS)[number];

/**
 * The customer's view of a decision (spec 11, section 6): the seller's or the
 * system's reason code, shown translated. A customer's own cancellation and an
 * administrator's carry no reason here; free text never reaches the customer.
 */
export interface CustomerShopOrderDecision {
  cancelledBy: ShopOrderCanceller | null;
  reason: SellerCancellationReason | SystemCancellationReason | null;
}

export interface CustomerShopOrder {
  id: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
  /** The delivery's status (spec 12); `null` until the seller confirms. */
  deliveryStatus: DeliveryStatus | null;
  /** Delivery progress (spec 12, section 9); `null` until the seller confirms. */
  deliveryProgress: CustomerDeliveryProgress | null;
  /** The seller must answer before this time (D7). */
  respondBy: string;
  /** When the shop order reached a final status, if it has. */
  closedAt: string | null;
  decision: CustomerShopOrderDecision;
  /** Decided by the API: `PENDING` and before `respondBy`. */
  canCancel: boolean;
  /** Name and contact phones at placement (S2-7). Phones are unverified. */
  shop: { id: string; name: string; contactPhone: string; whatsappPhone: string | null };
  productsSubtotal: string;
  deliveryFee: string;
  total: string;
  delivery: OrderDeliverySnapshot;
  items: CustomerOrderItem[];
  payment: CustomerPayment;
}

/** The customer's view of an order (spec 11, section 10). Amounts are decimal strings in MRU. */
export interface CustomerOrder {
  id: string;
  reference: string;
  createdAt: string;
  productsSubtotal: string;
  deliveryFeeTotal: string;
  total: string;
  paymentMethod: PaymentMethod;
  shopOrders: CustomerShopOrder[];
}

/**
 * Stable error codes of the order routes (spec 11).
 *
 * - `ORDER_NOT_FOUND` (404): unknown, or another customer's order (never disclosed).
 * - `SHOP_ORDER_NOT_FOUND` (404): unknown shop order, another shop's, or not in that order.
 * - `SHOP_ORDER_STATUS_CONFLICT` (409): the shop order is not in a state that allows this action.
 * - `SHOP_ORDER_EXPIRED` (409): the response deadline has passed; the shop order is (now) `EXPIRED`.
 */
export const ORDER_ERROR_CODES = {
  notFound: "ORDER_NOT_FOUND",
  shopOrderNotFound: "SHOP_ORDER_NOT_FOUND",
  statusConflict: "SHOP_ORDER_STATUS_CONFLICT",
  expired: "SHOP_ORDER_EXPIRED",
} as const;

/** Order notifications (spec 15, section 5) recorded by checkout (spec 10) and this feature (spec 11). */
export const ORDER_NOTIFICATION_TYPES = [
  "SHOP_ORDER_PLACED",
  "SHOP_ORDER_CONFIRMED",
  "SHOP_ORDER_REJECTED",
  "SHOP_ORDER_CANCELLED",
  "SHOP_ORDER_EXPIRED",
  "SHOP_ORDER_RESPONSE_REMINDER",
] as const;
export type OrderNotificationType = (typeof ORDER_NOTIFICATION_TYPES)[number];

/** Seller notification of a new shop order. Codes and figures only, never text. */
export interface ShopOrderPlacedPayload {
  orderReference: string;
  shopOrderId: string;
  itemsCount: number;
  total: string;
  respondBy: string;
}
