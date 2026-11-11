import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { NOTIFICATION_TYPES, type NotificationItem, type NotificationList } from "@chicman/shared"

import { NOTIFICATION_MESSAGES } from "./messages"
import {
  appendPage,
  describeNotification,
  interpretNotificationResult,
  markReadPath,
  notificationHref,
  notificationListPath,
  unreadBadge,
  withAllRead,
  withRead,
} from "./notifications-logic"

const AT = "2026-11-10T10:00:00.000Z"

const item = (overrides: Partial<NotificationItem> & Pick<NotificationItem, "type" | "payload">): NotificationItem =>
  ({ id: "n1", audience: "CUSTOMER", resource: null, createdAt: AT, readAt: null, ...overrides }) as NotificationItem

const SAMPLES: NotificationItem[] = [
  ...(["SHOP_APPLICATION_APPROVED", "SHOP_APPLICATION_REJECTED", "SHOP_SUSPENDED", "SHOP_REINSTATED"] as const).map((type) =>
    item({ type, audience: "SELLER", payload: { shopName: "Boutique Alpha", shopStatus: "APPROVED", decidedAt: AT } })
  ),
  item({
    type: "SHOP_CHANGE_REQUEST_APPROVED",
    audience: "SELLER",
    payload: { shopName: "Boutique Alpha", shopStatus: "APPROVED", changeRequestOutcome: "APPROVED", fields: ["shopName", "city"], decidedAt: AT },
  }),
  item({
    type: "SHOP_CHANGE_REQUEST_REJECTED",
    audience: "SELLER",
    payload: { shopName: "Boutique Alpha", shopStatus: "APPROVED", changeRequestOutcome: "REJECTED", fields: ["city"], decidedAt: AT },
  }),
  item({ type: "SHOP_ORDER_PLACED", audience: "SELLER", payload: { orderReference: "CM-1", shopOrderId: "so1", itemsCount: 2, total: "3100.00", respondBy: AT } }),
  item({ type: "SHOP_ORDER_CONFIRMED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha" } }),
  item({ type: "SHOP_ORDER_REJECTED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha", reasonCode: "OUT_OF_STOCK" } }),
  item({ type: "SHOP_ORDER_CANCELLED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha", cancelledBy: "CHICMAN", reasonCode: null } }),
  item({ type: "SHOP_ORDER_EXPIRED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha" } }),
  item({ type: "SHOP_ORDER_RESPONSE_REMINDER", audience: "SELLER", payload: { orderReference: "CM-1", respondBy: AT } }),
  item({ type: "DELIVERY_DISPATCHED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha", attemptNumber: 2 } }),
  item({ type: "DELIVERY_ATTEMPT_FAILED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha", reasonCode: "CUSTOMER_ABSENT" } }),
  item({ type: "DELIVERY_COMPLETED", payload: { orderReference: "CM-1", shopName: "Boutique Alpha", amountCollected: "3100.00" } }),
  item({ type: "DELIVERY_CLOSED_UNDELIVERABLE", payload: { orderReference: "CM-1", shopName: "Boutique Alpha" } }),
]

describe("notification texts (spec 15)", () => {
  it("has a sample for every type", () => {
    assert.deepEqual(new Set(SAMPLES.map(({ type }) => type)), new Set(NOTIFICATION_TYPES))
  })

  it("renders every type in French and Arabic, with no placeholder left", () => {
    for (const locale of ["fr", "ar"] as const) {
      for (const sample of SAMPLES) {
        const text = describeNotification(sample, locale)
        assert.ok(text.title.length > 0, `${locale} ${sample.type}`)
        assert.ok(text.body.length > 0, `${locale} ${sample.type}`)
        assert.doesNotMatch(`${text.title} ${text.body}`, /\{\w+\}|undefined|null/, `${locale} ${sample.type}`)
      }
    }
  })

  it("names the codes, the shop, and the figures, never a raw code", () => {
    const rejected = describeNotification(SAMPLES.find(({ type }) => type === "SHOP_ORDER_REJECTED")!, "fr")
    assert.match(rejected.body, /Article en rupture de stock/)
    assert.match(rejected.body, /Boutique Alpha/)
    assert.doesNotMatch(rejected.body, /OUT_OF_STOCK/)
    const cancelled = describeNotification(SAMPLES.find(({ type }) => type === "SHOP_ORDER_CANCELLED")!, "ar")
    assert.match(cancelled.body, /شيكمان/)
    const completed = describeNotification(SAMPLES.find(({ type }) => type === "DELIVERY_COMPLETED")!, "fr")
    assert.match(completed.body, /3 100,00 MRU/)
    const change = describeNotification(SAMPLES.find(({ type }) => type === "SHOP_CHANGE_REQUEST_APPROVED")!, "fr")
    assert.match(change.body, /nom de la boutique, ville/)
  })

  it("falls back to a generic title for a type from a newer API", () => {
    const unknown = item({ type: "SOMETHING_NEW" as never, payload: {} as never })
    assert.deepEqual(describeNotification(unknown, "fr"), { title: NOTIFICATION_MESSAGES.fr.unknownTitle, body: "" })
  })

  it("never claims an external delivery channel", () => {
    const all = JSON.stringify(NOTIFICATION_MESSAGES)
    assert.doesNotMatch(all, /e-?mail|SMS|push|courriel|البريد|رسالة نصية/i)
  })

  it("has the same keys in both languages", () => {
    const keys = (value: object): string[] =>
      Object.entries(value)
        .flatMap(([key, child]) => (typeof child === "object" && child !== null ? keys(child).map((sub) => `${key}.${sub}`) : [key]))
        .sort()
    assert.deepEqual(keys(NOTIFICATION_MESSAGES.ar), keys(NOTIFICATION_MESSAGES.fr))
  })
})

describe("notification links", () => {
  it("opens the resource through its own page, per audience", () => {
    assert.equal(notificationHref(item({ ...SAMPLES[0]!, resource: { type: "SHOP", id: "s1" } })), "/seller/shop")
    const customer = item({ ...SAMPLES[7]!, resource: { type: "SHOP_ORDER", id: "so1", orderId: "o1" } })
    assert.equal(notificationHref(customer), "/account/orders/o1")
    const seller = item({ ...SAMPLES[6]!, resource: { type: "SHOP_ORDER", id: "so1", orderId: null } })
    assert.equal(notificationHref(seller), "/seller/orders/so1")
    assert.equal(notificationHref(item({ ...SAMPLES[7]!, resource: { type: "SHOP_ORDER", id: "so1", orderId: null } })), null)
    assert.equal(notificationHref(item({ ...SAMPLES[7]!, resource: null })), null)
  })

  it("builds the API paths", () => {
    assert.equal(notificationListPath(null), "/customers/me/notifications")
    assert.equal(notificationListPath("a+b/c"), "/customers/me/notifications?cursor=a%2Bb%2Fc")
    assert.equal(markReadPath("n 1"), "/customers/me/notifications/n%201/read")
  })
})

describe("notification state", () => {
  const list: NotificationList = {
    items: [item({ ...SAMPLES[7]!, id: "a" }), item({ ...SAMPLES[8]!, id: "b", readAt: AT })],
    nextCursor: "c1",
  }

  it("appends a page without repeating an item", () => {
    const next: NotificationList = { items: [item({ ...SAMPLES[9]!, id: "b" }), item({ ...SAMPLES[9]!, id: "c" })], nextCursor: null }
    const merged = appendPage(list, next)
    assert.deepEqual(merged.items.map(({ id }) => id), ["a", "b", "c"])
    assert.equal(merged.nextCursor, null)
  })

  it("marks read locally, keeping a first read time", () => {
    const later = "2026-11-11T10:00:00.000Z"
    assert.equal(withRead(list, "a", later).items[0]?.readAt, later)
    assert.equal(withRead(list, "b", later).items[1]?.readAt, AT)
    assert.deepEqual(withAllRead(list, later).items.map(({ readAt }) => readAt), [later, AT])
  })

  it("caps the badge", () => {
    assert.equal(unreadBadge(7), "7")
    assert.equal(unreadBadge(100), "99+")
  })

  it("classifies API answers", () => {
    assert.deepEqual(interpretNotificationResult({ kind: "ok", status: 204, data: undefined }), { state: "ok", data: undefined })
    assert.deepEqual(interpretNotificationResult({ kind: "unauthorized" }), { state: "signed-out" })
    assert.deepEqual(interpretNotificationResult({ kind: "forbidden", code: null }), { state: "not-bootstrapped" })
    assert.deepEqual(interpretNotificationResult({ kind: "error", status: 404, code: "NOTIFICATION_NOT_FOUND" }), { state: "not-found" })
    assert.deepEqual(interpretNotificationResult({ kind: "error", status: 429, code: "RATE_LIMITED" }), { state: "failed", failure: "rate-limited" })
    assert.deepEqual(interpretNotificationResult({ kind: "network-error" }), { state: "failed", failure: "unavailable" })
    assert.deepEqual(interpretNotificationResult({ kind: "error", status: 500, code: null }), { state: "failed", failure: "error" })
  })
})
