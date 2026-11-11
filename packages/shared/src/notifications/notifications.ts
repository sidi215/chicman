import { z } from "zod";

import {
  DELIVERY_NOTIFICATION_TYPES,
  type DeliveryAttemptFailedPayload,
  type DeliveryClosedUndeliverablePayload,
  type DeliveryCompletedPayload,
  type DeliveryDispatchedPayload,
} from "../delivery/delivery.js";
import type {
  ShopOrderCancelledPayload,
  ShopOrderConfirmedPayload,
  ShopOrderExpiredPayload,
  ShopOrderRejectedPayload,
  ShopOrderResponseReminderPayload,
} from "../orders/lifecycle.js";
import { ORDER_NOTIFICATION_TYPES, type ShopOrderPlacedPayload } from "../orders/orders.js";
import type { ShopStatus } from "../auth/roles.js";
import { SHOP_NOTIFICATION_TYPES } from "../shops/constants.js";

/**
 * In-app notifications (spec 15). A notification is recorded in the
 * transaction of the business change that causes it, with a payload of codes,
 * names, and figures (never pre-written text); clients render it in French or
 * Arabic. No email, push, or SMS is sent: `deliveredAt` is not part of this
 * contract because no external channel exists.
 */

/** Every notification type (spec 15, section 5). */
export const NOTIFICATION_TYPES = [...SHOP_NOTIFICATION_TYPES, ...ORDER_NOTIFICATION_TYPES, ...DELIVERY_NOTIFICATION_TYPES] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Owner payload of the six shop decisions (spec 06). Never a reason, a note, or an administrator. */
export interface ShopDecisionNotificationPayload {
  shopName: string;
  /** Resulting shop status (the shop status is unchanged by change requests). */
  shopStatus: ShopStatus;
  /** Change-request outcome, for change-request decisions only. */
  changeRequestOutcome?: "APPROVED" | "REJECTED";
  /** Affected field names, for change-request decisions only. */
  fields?: ("shopName" | "city")[];
  decidedAt: string;
}

/** The payload of each type: the allowlist of section 5. */
export interface NotificationPayloads {
  SHOP_APPLICATION_APPROVED: ShopDecisionNotificationPayload;
  SHOP_APPLICATION_REJECTED: ShopDecisionNotificationPayload;
  SHOP_SUSPENDED: ShopDecisionNotificationPayload;
  SHOP_REINSTATED: ShopDecisionNotificationPayload;
  SHOP_CHANGE_REQUEST_APPROVED: ShopDecisionNotificationPayload;
  SHOP_CHANGE_REQUEST_REJECTED: ShopDecisionNotificationPayload;
  SHOP_ORDER_PLACED: ShopOrderPlacedPayload;
  SHOP_ORDER_CONFIRMED: ShopOrderConfirmedPayload;
  SHOP_ORDER_REJECTED: ShopOrderRejectedPayload;
  SHOP_ORDER_CANCELLED: ShopOrderCancelledPayload;
  SHOP_ORDER_EXPIRED: ShopOrderExpiredPayload;
  SHOP_ORDER_RESPONSE_REMINDER: ShopOrderResponseReminderPayload;
  DELIVERY_DISPATCHED: DeliveryDispatchedPayload;
  DELIVERY_ATTEMPT_FAILED: DeliveryAttemptFailedPayload;
  DELIVERY_COMPLETED: DeliveryCompletedPayload;
  DELIVERY_CLOSED_UNDELIVERABLE: DeliveryClosedUndeliverablePayload;
}

/**
 * Whom a notification addresses: the user as a customer (their own orders) or
 * as a seller (their shop and its orders). Worked out by the API from the type
 * and, for the types sent to both parties, from the shop order.
 */
export const NOTIFICATION_AUDIENCES = ["CUSTOMER", "SELLER"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/** Types only ever sent to the customer of a shop order. */
export const CUSTOMER_ONLY_NOTIFICATION_TYPES = [
  "SHOP_ORDER_CONFIRMED",
  "SHOP_ORDER_REJECTED",
  ...DELIVERY_NOTIFICATION_TYPES,
] as const satisfies readonly NotificationType[];

/** Types sent to the customer or the seller of a shop order (section 5): the shop order decides which. */
export const SHARED_ORDER_NOTIFICATION_TYPES = ["SHOP_ORDER_CANCELLED", "SHOP_ORDER_EXPIRED"] as const satisfies readonly NotificationType[];

export const NOTIFICATION_RESOURCE_TYPES = ["SHOP", "SHOP_ORDER"] as const;
export type NotificationResourceType = (typeof NOTIFICATION_RESOURCE_TYPES)[number];

/**
 * What the notification points at. A reference never grants access: opening
 * it goes through that resource's own route, which checks ownership again.
 * `orderId` is given to the customer only, for the customer order page; the
 * seller opens the shop order by its own ID.
 */
export type NotificationResource = { type: "SHOP"; id: string } | { type: "SHOP_ORDER"; id: string; orderId: string | null };

interface NotificationItemOf<T extends NotificationType> {
  id: string;
  type: T;
  payload: NotificationPayloads[T];
  audience: NotificationAudience;
  /** `null` for rows recorded before resource references existed. */
  resource: NotificationResource | null;
  /** When the business change committed (ISO 8601, UTC). */
  createdAt: string;
  /** When the recipient marked it read; `null` while unread. */
  readAt: string | null;
}

export type NotificationItem = { [T in NotificationType]: NotificationItemOf<T> }[NotificationType];

/** Newest first. `nextCursor` is `null` on the last page. */
export interface NotificationList {
  items: NotificationItem[];
  nextCursor: string | null;
}

export interface NotificationUnreadCount {
  unread: number;
}

export const NOTIFICATION_LIST_DEFAULT_LIMIT = 20;
export const NOTIFICATION_LIST_MAX_LIMIT = 50;

/**
 * `audience=CUSTOMER` narrows a route to the customer order notifications, for
 * the mobile app (section 7, O1 and O6). Without it, every notification of the
 * user is included.
 */
const audience = z.enum(["CUSTOMER"]).optional();

/** `GET /customers/me/notifications`. The cursor is opaque: the API's own `nextCursor`. */
export const notificationListQuerySchema = z.strictObject({
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATION_LIST_MAX_LIMIT).default(NOTIFICATION_LIST_DEFAULT_LIMIT),
  audience,
});
export type NotificationListQuery = z.output<typeof notificationListQuerySchema>;

/** `GET …/unread-count` and `POST …/read-all`. */
export const notificationScopeQuerySchema = z.strictObject({ audience });
export type NotificationScopeQuery = z.output<typeof notificationScopeQuerySchema>;

/**
 * Stable error codes of the notification endpoints.
 *
 * - `NOTIFICATION_NOT_FOUND` (404): no such notification for this user. Another
 *   user's notification gives the same answer.
 * - An unknown or malformed cursor is `BAD_REQUEST` (400).
 */
export const NOTIFICATION_ERROR_CODES = {
  notFound: "NOTIFICATION_NOT_FOUND",
} as const;
