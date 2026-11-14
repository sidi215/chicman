import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { adminOrderCancellationSchema, adminOrderListQuerySchema, adminShopListQuerySchema, paymentNoteSchema } from "@chicman/shared"

import {
  ADMIN_AREA_HREF,
  ADMIN_AREAS,
  ADMIN_SHOP_FILTERS,
  adminAreaOf,
  adminOrderCancelPath,
  adminOrderListPath,
  adminPaymentNotePath,
  adminShopListPath,
  adminShopOrdersHref,
  buildOrderCancellation,
  buildPaymentNote,
  EMPTY_ORDER_FILTERS,
  pageCount,
  searchTerm,
  shopIdFilter,
} from "./admin-dashboard"
import { ADMIN_MESSAGES } from "./messages"

const SHOP_ID = "5b4dccd0-fba3-4af5-93be-4ed8f5aff1c3"
const query = (path: string) => Object.fromEntries(new URLSearchParams(path.split("?")[1]))

describe("admin areas", () => {
  it("finds the area of a path, with or without the Arabic prefix", () => {
    assert.equal(adminAreaOf("/admin/shops"), "shops")
    assert.equal(adminAreaOf("/admin/shops/abc"), "shops")
    assert.equal(adminAreaOf("/admin/orders/"), "orders")
    assert.equal(adminAreaOf("/ar/admin/orders/abc"), "orders")
    assert.equal(adminAreaOf("/admin"), null)
    assert.equal(adminAreaOf("/admin/users"), null)
    assert.equal(adminAreaOf("/seller/orders"), null)
  })

  it("links every area and names it in both languages", () => {
    for (const area of ADMIN_AREAS) {
      assert.equal(adminAreaOf(ADMIN_AREA_HREF[area]), area)
      assert.ok(ADMIN_MESSAGES.fr.nav[area])
      assert.ok(ADMIN_MESSAGES.ar.nav[area])
    }
  })
})

describe("shop list query", () => {
  it("is accepted by the API's schema for every filter", () => {
    for (const filter of ADMIN_SHOP_FILTERS) {
      const parsed = adminShopListQuerySchema.safeParse(query(adminShopListPath(filter, " Maison ", 2)))
      assert.ok(parsed.success, filter)
      assert.equal(parsed.data.page, 2)
      assert.equal(parsed.data.q, "Maison")
    }
  })

  it("sends the filter, leaves out an empty search, and lists everything for 'all'", () => {
    assert.deepEqual(query(adminShopListPath("PENDING", "", 1)), { status: "PENDING", page: "1" })
    assert.deepEqual(query(adminShopListPath("changes", "   ", 1)), { openChangeRequest: "true", page: "1" })
    assert.deepEqual(query(adminShopListPath("all", "atar", 3)), { q: "atar", page: "3" })
  })

  it("trims and bounds the search", () => {
    assert.equal(searchTerm("  "), null)
    assert.equal(searchTerm(" Lalla "), "Lalla")
    assert.equal(searchTerm("x".repeat(150))?.length, 100)
  })
})

describe("order list query", () => {
  it("sends only the filters that are set, checked with the API's schema", () => {
    const result = adminOrderListPath(EMPTY_ORDER_FILTERS, 1)
    assert.deepEqual(result, { ok: true, path: "/admin/orders?page=1" })
    const full = adminOrderListPath({ status: "CONFIRMED", shopId: SHOP_ID, reference: " cm-7k3qx9 ", from: "2026-11-01", to: "2026-11-14" }, 2)
    assert.ok(full.ok)
    assert.deepEqual(query(full.path), { status: "CONFIRMED", shopId: SHOP_ID, reference: "7K3QX9", from: "2026-11-01", to: "2026-11-14", page: "2" })
    assert.ok(adminOrderListQuerySchema.safeParse(query(full.path)).success)
  })

  it("refuses a reference that cannot be part of one, and reversed dates", () => {
    assert.deepEqual(adminOrderListPath({ ...EMPTY_ORDER_FILTERS, reference: "ab" }, 1), { ok: false, error: "reference" })
    assert.deepEqual(adminOrderListPath({ ...EMPTY_ORDER_FILTERS, reference: "CM-%%%" }, 1), { ok: false, error: "reference" })
    assert.deepEqual(adminOrderListPath({ ...EMPTY_ORDER_FILTERS, from: "2026-11-14", to: "2026-11-01" }, 1), { ok: false, error: "dateOrder" })
    assert.ok(adminOrderListPath({ ...EMPTY_ORDER_FILTERS, from: "2026-11-14", to: "2026-11-14" }, 1).ok)
  })

  it("keeps a shop filter from the URL only when it is a UUID", () => {
    assert.equal(shopIdFilter(SHOP_ID), SHOP_ID)
    assert.equal(shopIdFilter("not-a-uuid"), null)
    assert.equal(shopIdFilter([SHOP_ID]), null)
    assert.equal(shopIdFilter(undefined), null)
    assert.equal(adminShopOrdersHref(SHOP_ID), `/admin/orders?shopId=${SHOP_ID}`)
  })

  it("counts pages", () => {
    assert.equal(pageCount(0, 20), 1)
    assert.equal(pageCount(20, 20), 1)
    assert.equal(pageCount(21, 20), 2)
  })
})

describe("administrator actions (D6, D9)", () => {
  it("only targets the three allowed order routes", () => {
    assert.equal(adminOrderCancelPath("a/b"), "/admin/orders/a%2Fb/cancel")
    assert.equal(adminPaymentNotePath("id"), "/admin/orders/id/payment/notes")
  })

  it("builds the cancellation with a required internal reason and an optional note", () => {
    const ok = buildOrderCancellation("  Client injoignable, annulation support  ", "")
    assert.ok(ok.ok)
    assert.deepEqual(ok.body, { internalReason: "Client injoignable, annulation support" })
    assert.ok(adminOrderCancellationSchema.safeParse(ok.body).success)
    const withNote = buildOrderCancellation("Client injoignable, annulation support", "Ticket 42")
    assert.ok(withNote.ok)
    assert.deepEqual(withNote.body, { internalReason: "Client injoignable, annulation support", internalNote: "Ticket 42" })
    assert.deepEqual(buildOrderCancellation("court", ""), { ok: false, errors: { reason: "reasonLength" } })
    assert.deepEqual(buildOrderCancellation("x".repeat(501), ""), { ok: false, errors: { reason: "reasonLength" } })
  })

  it("builds a payment note with a reason only", () => {
    const ok = buildPaymentNote(" Montant contesté par le client ")
    assert.deepEqual(ok, { ok: true, body: { reason: "Montant contesté par le client" } })
    assert.ok(paymentNoteSchema.safeParse(ok.ok ? ok.body : null).success)
    assert.deepEqual(buildPaymentNote("court"), { ok: false, error: "reasonLength" })
    assert.deepEqual(buildPaymentNote("Motif avec \u0007 contrôle"), { ok: false, error: "reasonInvalid" })
  })
})

describe("admin messages", () => {
  it("have the same keys in French and Arabic", () => {
    const keys = (value: unknown, prefix = ""): string[] =>
      value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`)) : [prefix]
    assert.deepEqual(keys(ADMIN_MESSAGES.ar).sort(), keys(ADMIN_MESSAGES.fr).sort())
  })
})
