import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CustomerAddress, CustomerOrderListItem } from "@chicman/shared"

import { NOTIFICATIONS_HREF } from "@/features/notifications/notifications-logic"

import {
  addressLine,
  BUYER_AREA_HREF,
  BUYER_AREAS,
  buyerAreaOf,
  defaultAddress,
  greetingName,
  openShopOrderCount,
  RECENT_ORDERS_PATH,
  showsBuyerShell,
} from "./buyer-dashboard"
import { BUYER_MESSAGES } from "./messages"

const address = (fields: Partial<CustomerAddress>): CustomerAddress => ({
  id: "a",
  label: null,
  city: "Nouakchott",
  district: "Tevragh Zeina",
  landmark: "Près de la mosquée",
  deliveryPhone: null,
  latitude: 18.1,
  longitude: -15.9,
  locationSource: "MANUAL",
  accuracyMeters: null,
  locationConfirmedAt: "2026-11-01T00:00:00Z",
  isDefault: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...fields,
})

const order = (statuses: string[]): CustomerOrderListItem =>
  ({
    id: "o",
    reference: "CM-1",
    createdAt: "2026-11-01T00:00:00Z",
    total: "100.00",
    itemsCount: 1,
    shopOrders: statuses.map((status, index) => ({ id: `s${index}`, shopName: "Boutique", status, label: status })),
  }) as unknown as CustomerOrderListItem

describe("buyer dashboard areas", () => {
  it("maps every path of the dashboard to its area, with or without a locale", () => {
    assert.equal(buyerAreaOf("/account"), "overview")
    assert.equal(buyerAreaOf("/account/"), "overview")
    assert.equal(buyerAreaOf("/fr/account/orders"), "orders")
    assert.equal(buyerAreaOf("/ar/account/orders/abc"), "orders")
    assert.equal(buyerAreaOf("/account/addresses/new"), "addresses")
    assert.equal(buyerAreaOf("/account/favorites"), "favorites")
    assert.equal(buyerAreaOf("/account/notifications"), "notifications")
    assert.equal(buyerAreaOf("/account/profile"), "profile")
    assert.equal(buyerAreaOf("/account/setup"), null)
    assert.equal(buyerAreaOf("/account/overview"), null)
    assert.equal(buyerAreaOf("/seller"), null)
  })

  it("links every area inside /account, and the header bell to the dashboard", () => {
    for (const area of BUYER_AREAS) assert.ok(BUYER_AREA_HREF[area].startsWith("/account"))
    for (const area of BUYER_AREAS) assert.equal(buyerAreaOf(BUYER_AREA_HREF[area]), area)
    assert.equal(NOTIFICATIONS_HREF, BUYER_AREA_HREF.notifications)
  })

  it("shows the shell to buyers and while loading, never to other types or without an account", () => {
    assert.equal(showsBuyerShell({ state: "active", userId: "u", accountType: "BUYER" }), true)
    assert.equal(showsBuyerShell({ state: "loading" }), true)
    assert.equal(showsBuyerShell({ state: "active", userId: "u", accountType: "SELLER" }), false)
    assert.equal(showsBuyerShell({ state: "active", userId: "u", accountType: "ADMIN" }), false)
    assert.equal(showsBuyerShell({ state: "needs-setup" }), false)
  })
})

describe("buyer overview", () => {
  it("reads only the latest orders", () => {
    assert.equal(RECENT_ORDERS_PATH, "/customers/me/orders?page=1&pageSize=3")
  })

  it("picks the default address by its flag and describes it on one line", () => {
    assert.equal(defaultAddress([address({ id: "x" }), address({ id: "d", isDefault: true })])?.id, "d")
    assert.equal(defaultAddress([address({})]), null)
    assert.equal(addressLine(address({})), "Tevragh Zeina, Nouakchott")
    assert.equal(addressLine(address({ label: "Maison" })), "Maison · Tevragh Zeina, Nouakchott")
    assert.equal(addressLine(address({ label: "  " })), "Tevragh Zeina, Nouakchott")
  })

  it("counts shop orders still waiting or confirmed", () => {
    assert.equal(openShopOrderCount([order(["PENDING", "DELIVERED"]), order(["CONFIRMED", "CANCELLED", "EXPIRED"])]), 2)
    assert.equal(openShopOrderCount([]), 0)
  })

  it("greets by first name", () => {
    assert.equal(greetingName("Aïcha Mint Ahmed"), "Aïcha")
    assert.equal(greetingName("  "), null)
    assert.equal(greetingName(null), null)
  })

  it("has every text in both languages", () => {
    const keys = (value: object): string[] => Object.entries(value).flatMap(([key, item]) => (typeof item === "object" ? keys(item).map((sub) => `${key}.${sub}`) : [key]))
    assert.deepEqual(keys(BUYER_MESSAGES.ar).sort(), keys(BUYER_MESSAGES.fr).sort())
    for (const locale of ["fr", "ar"] as const) assert.ok(BUYER_MESSAGES[locale].greeting.includes("{name}"))
  })
})
