import type { AddressLocationSource } from "../addresses/address.js";

/**
 * Orders (spec 11). One order per checkout, one shop order per shop in it, and
 * one order item per cart line. Only what checkout (spec 10) creates and shows
 * is defined so far; the lifecycle routes belong to spec 11.
 */

/** Shop order statuses (D4, D7). Delivery progress is not an order status (spec 12). */
export const SHOP_ORDER_STATUSES = ["PENDING", "CONFIRMED", "REJECTED", "CANCELLED", "EXPIRED", "DELIVERED", "FAILED_DELIVERY"] as const;
export type ShopOrderStatus = (typeof SHOP_ORDER_STATUSES)[number];

/** Delivery statuses (spec 12, D4). Used here only to derive the customer label. */
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

export interface CustomerShopOrder {
  id: string;
  status: ShopOrderStatus;
  label: ShopOrderLabel;
  /** The seller must answer before this time (D7). */
  respondBy: string;
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

/** `ORDER_NOT_FOUND` (404): unknown, or another customer's order (never disclosed). */
export const ORDER_ERROR_CODES = {
  notFound: "ORDER_NOT_FOUND",
} as const;

/** Order notifications (spec 15, section 5). Only those recorded so far are listed. */
export const ORDER_NOTIFICATION_TYPES = ["SHOP_ORDER_PLACED"] as const;
export type OrderNotificationType = (typeof ORDER_NOTIFICATION_TYPES)[number];

/** Seller notification of a new shop order. Codes and figures only, never text. */
export interface ShopOrderPlacedPayload {
  orderReference: string;
  shopOrderId: string;
  itemsCount: number;
  total: string;
  respondBy: string;
}
