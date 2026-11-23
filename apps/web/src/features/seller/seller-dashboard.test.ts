import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { productListQuerySchema, sellerOrderListQuerySchema, type OwnerShopResponse, type ShopStatus } from "@chicman/shared"

import { SELLER_MESSAGES } from "./messages"
import {
  isAreaAllowed,
  needsDeliveryFee,
  SELLER_AREA_HREF,
  SELLER_AREAS,
  sellerAccess,
  sellerAreaOf,
  sellerAreas,
  sellerGate,
  sellerOrderCountPath,
  sellerProductCountPath,
  type SellerAccess,
  type SellerShopState,
} from "./seller-dashboard"

const shop = (status: ShopStatus, deliveryFee: string | null = "150.00"): OwnerShopResponse =>
  ({ id: "s1", shopName: "Boutique", status, deliveryFee }) as unknown as OwnerShopResponse

const loaded = (status: ShopStatus, deliveryFee?: string | null): SellerShopState => ({ state: "shop", shop: shop(status, deliveryFee) })

/** Seller operations: everything but the overview, shop status page, and notifications. */
const OPERATIONS = ["products", "orders", "deliveries", "payments"] as const

describe("seller areas by shop status", () => {
  it("opens every area to an approved shop only", () => {
    assert.deepEqual([...sellerAreas("APPROVED")], [...SELLER_AREAS])
    for (const access of ["none", "PENDING", "REJECTED", "SUSPENDED"] as const) {
      assert.ok(sellerAreas(access).length < SELLER_AREAS.length, access)
    }
  })

  it("keeps applicants and users without a shop to the application and status pages", () => {
    for (const access of ["none", "PENDING", "REJECTED"] as const) {
      assert.deepEqual([...sellerAreas(access)], ["overview", "shop", "notifications", "profile"])
      for (const area of OPERATIONS) assert.equal(isAreaAllowed(area, access), false, `${access} ${area}`)
    }
  })

  it("leaves a suspended shop only its deliveries to finish (D8)", () => {
    assert.deepEqual([...sellerAreas("SUSPENDED")], ["overview", "shop", "deliveries", "notifications", "profile"])
    for (const area of ["products", "orders", "payments"] as const) assert.equal(isAreaAllowed(area, "SUSPENDED"), false)
  })

  it("offers the shared profile page in every shop status, as the buyer and administrator areas do", () => {
    for (const access of ["none", "PENDING", "REJECTED", "APPROVED", "SUSPENDED"] as const) assert.equal(isAreaAllowed("profile", access), true, access)
    assert.equal(SELLER_AREA_HREF.profile, "/account/profile")
    assert.equal(sellerAreaOf("/account/profile"), "profile")
    assert.equal(sellerAreaOf("/ar/account/profile/"), "profile")
    assert.equal(sellerAreaOf("/account/orders"), null)
  })

  it("maps shop states to access", () => {
    assert.equal(sellerAccess({ state: "no-shop" }), "none")
    assert.equal(sellerAccess(loaded("SUSPENDED")), "SUSPENDED")
    assert.equal(sellerAccess({ state: "loading" }), null)
    assert.equal(sellerAccess({ state: "unavailable" }), null)
    assert.equal(sellerAccess({ state: "error" }), null)
  })
})

describe("sellerAreaOf", () => {
  it("reads the area with or without a locale prefix", () => {
    assert.equal(sellerAreaOf("/seller"), "overview")
    assert.equal(sellerAreaOf("/seller/"), "overview")
    assert.equal(sellerAreaOf("/ar/seller"), "overview")
    assert.equal(sellerAreaOf("/seller/orders/abc"), "orders")
    assert.equal(sellerAreaOf("/ar/seller/products/new"), "products")
    assert.equal(sellerAreaOf("/seller/payments"), "payments")
  })

  it("knows nothing outside the seller area or of unknown sections", () => {
    assert.equal(sellerAreaOf("/account"), null)
    assert.equal(sellerAreaOf("/sellers"), null)
    assert.equal(sellerAreaOf("/seller/overview"), null)
    assert.equal(sellerAreaOf("/seller/unknown"), null)
  })

  it("has an href for every area that maps back to it", () => {
    for (const area of SELLER_AREAS) assert.equal(sellerAreaOf(SELLER_AREA_HREF[area]), area)
  })
})

describe("sellerGate", () => {
  it("waits for the shop before showing a page", () => {
    assert.deepEqual(sellerGate("orders", { state: "loading" }), { kind: "loading" })
  })

  it("shows every page to an approved shop", () => {
    for (const area of SELLER_AREAS) assert.deepEqual(sellerGate(area, loaded("APPROVED")), { kind: "page" })
  })

  it("restricts seller operations for customers without a shop, applicants, and suspended shops", () => {
    assert.deepEqual(sellerGate("orders", { state: "no-shop" }), { kind: "restricted", access: "none" })
    assert.deepEqual(sellerGate("products", loaded("PENDING")), { kind: "restricted", access: "PENDING" })
    assert.deepEqual(sellerGate("payments", loaded("REJECTED")), { kind: "restricted", access: "REJECTED" })
    assert.deepEqual(sellerGate("orders", loaded("SUSPENDED")), { kind: "restricted", access: "SUSPENDED" })
  })

  it("keeps the application page open without a shop and the deliveries open when suspended", () => {
    assert.deepEqual(sellerGate("shop", { state: "no-shop" }), { kind: "page" })
    assert.deepEqual(sellerGate("deliveries", loaded("SUSPENDED")), { kind: "page" })
  })

  it("lets the page and its API decide when the shop cannot be read", () => {
    assert.deepEqual(sellerGate("orders", { state: "unavailable" }), { kind: "page" })
    assert.deepEqual(sellerGate("orders", { state: "error" }), { kind: "page" })
  })
})

describe("needsDeliveryFee (D2)", () => {
  it("asks only an approved shop without a fee", () => {
    assert.equal(needsDeliveryFee(shop("APPROVED", null)), true)
    assert.equal(needsDeliveryFee(shop("APPROVED", "0.00")), false)
    assert.equal(needsDeliveryFee(shop("PENDING", null)), false)
    assert.equal(needsDeliveryFee(shop("SUSPENDED", null)), false)
  })
})

describe("summary reads", () => {
  it("ask the existing list APIs for one row with valid queries", () => {
    for (const status of ["PENDING", "CONFIRMED"] as const) {
      const path = sellerOrderCountPath(status)
      assert.ok(path.startsWith("/sellers/me/orders?"))
      assert.deepEqual(sellerOrderListQuerySchema.parse(Object.fromEntries(new URLSearchParams(path.split("?")[1]))), { status, page: 1, pageSize: 1 })
    }
    for (const status of ["PUBLISHED", "DRAFT"] as const) {
      const path = sellerProductCountPath(status)
      assert.ok(path.startsWith("/sellers/me/products?"))
      assert.deepEqual(productListQuerySchema.parse(Object.fromEntries(new URLSearchParams(path.split("?")[1]))), { status, page: 1, pageSize: 1 })
    }
  })
})

describe("seller messages", () => {
  it("have the same keys in French and Arabic", () => {
    const keys = (value: unknown): string[] =>
      typeof value === "object" && value !== null ? Object.entries(value).flatMap(([key, inner]) => [key, ...keys(inner).map((k) => `${key}.${k}`)]) : []
    assert.deepEqual(keys(SELLER_MESSAGES.ar), keys(SELLER_MESSAGES.fr))
  })

  it("explain every restricted state without an empty text", () => {
    for (const access of ["none", "PENDING", "REJECTED", "SUSPENDED"] as const satisfies readonly SellerAccess[]) {
      for (const locale of ["fr", "ar"] as const) {
        assert.ok(SELLER_MESSAGES[locale].restricted[access].length > 0)
        assert.ok(SELLER_MESSAGES[locale].restrictedAction[access].length > 0)
      }
    }
  })
})
