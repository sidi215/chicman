import type { NotificationItem, NotificationList, NotificationUnreadCount } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"
import type { Locale } from "@/lib/locale"
import { formatDateTime } from "@/lib/date-time"
import { formatMru } from "@/lib/money"
import { DELIVERY_FAILURE_TEXT, ORDER_MESSAGES } from "@/features/orders/messages"
import { accountOrderHref, sellerOrderHref } from "@/features/orders/order-logic"

import { NOTIFICATION_MESSAGES, type NotificationMessages } from "./messages"

/**
 * Client side of notifications (spec 15). The API decides the recipient, the
 * audience, and the resource; the client only renders the payload's codes and
 * names in the UI language and opens the resource's own page, which checks
 * access again. In-app only: nothing here sends or receives a push or email.
 */
export const NOTIFICATIONS_PATH = "/customers/me/notifications"
export const UNREAD_COUNT_PATH = `${NOTIFICATIONS_PATH}/unread-count`
export const READ_ALL_PATH = `${NOTIFICATIONS_PATH}/read-all`
export const NOTIFICATIONS_HREF = "/notifications"

export const notificationListPath = (cursor: string | null): string =>
  cursor === null ? NOTIFICATIONS_PATH : `${NOTIFICATIONS_PATH}?cursor=${encodeURIComponent(cursor)}`
export const markReadPath = (id: string): string => `${NOTIFICATIONS_PATH}/${encodeURIComponent(id)}/read`

export type NotificationFailure = "rate-limited" | "unavailable" | "error"

export type NotificationOutcome<T> =
  { state: "ok"; data: T } | { state: "signed-out" } | { state: "not-bootstrapped" } | { state: "not-found" } | { state: "failed"; failure: NotificationFailure }

export function interpretNotificationResult<T>(result: ApiResult<T>): NotificationOutcome<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      // A valid token without account setup.
      return { state: "not-bootstrapped" }
    case "auth-unavailable":
    case "network-error":
      return { state: "failed", failure: "unavailable" }
    case "error":
      if (result.status === 404) return { state: "not-found" }
      if (result.status === 429) return { state: "failed", failure: "rate-limited" }
      if (result.status === 503) return { state: "failed", failure: "unavailable" }
      return { state: "failed", failure: "error" }
  }
}

export type { NotificationList, NotificationUnreadCount }

/** The count on the bell, capped so it fits the badge. */
export function unreadBadge(count: number): string {
  return count > 99 ? "99+" : String(count)
}

/**
 * The page the notification opens, through the resource's normal route, or
 * `null` when it points at nothing the user can open from here.
 */
export function notificationHref(item: NotificationItem): string | null {
  const resource = item.resource
  if (resource === null) return null
  if (resource.type === "SHOP") return "/seller/shop"
  if (item.audience === "CUSTOMER") return resource.orderId === null ? null : accountOrderHref(resource.orderId)
  return sellerOrderHref(resource.id)
}

/** Appends a further page, keeping each notification once. */
export function appendPage(current: NotificationList, next: NotificationList): NotificationList {
  const seen = new Set(current.items.map(({ id }) => id))
  return { items: [...current.items, ...next.items.filter(({ id }) => !seen.has(id))], nextCursor: next.nextCursor }
}

/** Marks one item read locally, after the API accepted it. */
export function withRead(list: NotificationList, id: string, at: string): NotificationList {
  return { ...list, items: list.items.map((item) => (item.id === id && item.readAt === null ? { ...item, readAt: at } : item)) }
}

export function withAllRead(list: NotificationList, at: string): NotificationList {
  return { ...list, items: list.items.map((item) => (item.readAt === null ? { ...item, readAt: at } : item)) }
}

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)

export interface NotificationText {
  title: string
  body: string
}

/** The text of a notification, from its codes and names, in the UI language. Seller names are never translated. */
export function describeNotification(item: NotificationItem, locale: Locale): NotificationText {
  const t: NotificationMessages = NOTIFICATION_MESSAGES[locale]
  const reasons = ORDER_MESSAGES[locale].reasons
  switch (item.type) {
    case "SHOP_APPLICATION_APPROVED":
    case "SHOP_APPLICATION_REJECTED":
    case "SHOP_SUSPENDED":
    case "SHOP_REINSTATED":
      return { title: t.titles[item.type], body: fill(t.bodies.shop, { shop: item.payload.shopName }) }
    case "SHOP_CHANGE_REQUEST_APPROVED":
    case "SHOP_CHANGE_REQUEST_REJECTED": {
      const fields = (item.payload.fields ?? []).map((field) => t.fields[field]).join(t.fieldSeparator)
      return { title: t.titles[item.type], body: fill(fields === "" ? t.bodies.shop : t.bodies.changeRequest, { shop: item.payload.shopName, fields }) }
    }
    case "SHOP_ORDER_PLACED":
      return {
        title: t.titles.SHOP_ORDER_PLACED,
        body: fill(t.bodies.placed, {
          reference: item.payload.orderReference,
          count: String(item.payload.itemsCount),
          total: formatMru(item.payload.total, locale),
          deadline: formatDateTime(item.payload.respondBy, locale),
        }),
      }
    case "SHOP_ORDER_RESPONSE_REMINDER":
      return {
        title: t.titles.SHOP_ORDER_RESPONSE_REMINDER,
        body: fill(t.bodies.reminder, { reference: item.payload.orderReference, deadline: formatDateTime(item.payload.respondBy, locale) }),
      }
    case "SHOP_ORDER_CONFIRMED":
    case "SHOP_ORDER_EXPIRED":
    case "DELIVERY_CLOSED_UNDELIVERABLE":
      return { title: t.titles[item.type], body: fill(t.bodies.order, { reference: item.payload.orderReference, shop: item.payload.shopName }) }
    case "SHOP_ORDER_REJECTED":
      return {
        title: t.titles.SHOP_ORDER_REJECTED,
        body: fill(t.bodies.withReason, { reference: item.payload.orderReference, shop: item.payload.shopName, reason: reasons[item.payload.reasonCode] }),
      }
    case "SHOP_ORDER_CANCELLED": {
      const values = { reference: item.payload.orderReference, shop: item.payload.shopName, by: t.cancelledBy[item.payload.cancelledBy] }
      return {
        title: t.titles.SHOP_ORDER_CANCELLED,
        body:
          item.payload.reasonCode === null
            ? fill(t.bodies.cancelled, values)
            : fill(t.bodies.cancelledWithReason, { ...values, reason: reasons[item.payload.reasonCode] }),
      }
    }
    case "DELIVERY_DISPATCHED":
      return {
        title: t.titles.DELIVERY_DISPATCHED,
        body: fill(t.bodies.dispatched, { reference: item.payload.orderReference, shop: item.payload.shopName, attempt: String(item.payload.attemptNumber) }),
      }
    case "DELIVERY_ATTEMPT_FAILED":
      return {
        title: t.titles.DELIVERY_ATTEMPT_FAILED,
        body: fill(t.bodies.withReason, {
          reference: item.payload.orderReference,
          shop: item.payload.shopName,
          reason: DELIVERY_FAILURE_TEXT[locale][item.payload.reasonCode],
        }),
      }
    case "DELIVERY_COMPLETED":
      return {
        title: t.titles.DELIVERY_COMPLETED,
        body: fill(t.bodies.completed, { reference: item.payload.orderReference, shop: item.payload.shopName, amount: formatMru(item.payload.amountCollected, locale) }),
      }
    default:
      // A type from a newer API: shown generically until the client knows it.
      return { title: t.unknownTitle, body: "" }
  }
}
