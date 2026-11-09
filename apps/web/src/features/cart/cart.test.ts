import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { Cart, CartItem, CartItemIssue } from "@chicman/shared"

import {
  acceptPriceRequest,
  addItemRequest,
  canOpenProduct,
  cartBadge,
  hasExcludedItems,
  interpretCartResult,
  priceToAccept,
  quantityControls,
  removeItemRequest,
  setQuantityRequest,
} from "./cart-logic"
import { CART_MESSAGES, issueText } from "./messages"

const item = (overrides: Partial<CartItem> = {}): CartItem => ({
  id: "i1",
  productId: "p1",
  variantId: null,
  name: "Melhfa",
  imageUrl: "https://media.test/p1.png",
  size: null,
  color: null,
  quantity: 2,
  unitPrice: "1500.00",
  subtotal: "3000.00",
  purchasable: true,
  issues: [],
  ...overrides,
})

const cart = (items: CartItem[]): Cart => ({ shops: [{ shop: { id: "s1", name: "Boutique" }, items, subtotal: "0.00" }], itemCount: 0, subtotal: "0.00" })

describe("cart requests", () => {
  it("never sends a price, a shop, or an owner when adding or updating", () => {
    const add = addItemRequest({ productId: "p1", quantity: 1, variantId: "v1" })
    assert.equal(add.path, "/customers/me/cart/items")
    assert.deepEqual(JSON.parse(String(add.init.body)), { productId: "p1", quantity: 1, variantId: "v1" })
    const update = setQuantityRequest("i1", 3)
    assert.equal(update.path, "/customers/me/cart/items/i1")
    assert.equal(update.init.method, "PATCH")
    assert.deepEqual(JSON.parse(String(update.init.body)), { quantity: 3 })
  })

  it("sends the price shown only to acknowledge it, and removes by line", () => {
    assert.equal(acceptPriceRequest("i1", "9.00").path, "/customers/me/cart/items/i1/accept-price")
    assert.deepEqual(JSON.parse(String(acceptPriceRequest("i1", "9.00").init.body)), { price: "9.00" })
    assert.deepEqual(removeItemRequest("i1"), { path: "/customers/me/cart/items/i1", init: { method: "DELETE" } })
  })
})

describe("interpretCartResult", () => {
  it("separates signed-out, account setup, and temporary failures", () => {
    assert.deepEqual(interpretCartResult({ kind: "unauthorized" }), { state: "signed-out" })
    assert.deepEqual(interpretCartResult({ kind: "forbidden", code: "ACCOUNT_NOT_BOOTSTRAPPED" }), { state: "not-bootstrapped" })
    for (const result of [{ kind: "network-error" }, { kind: "auth-unavailable" }, { kind: "error", status: 503, code: "SERVICE_UNAVAILABLE" }] as const) {
      assert.deepEqual(interpretCartResult(result), { state: "failed", failure: "unavailable" })
    }
    assert.deepEqual(interpretCartResult({ kind: "error", status: 429, code: "RATE_LIMITED" }), { state: "failed", failure: "rate-limited" })
  })

  it("maps each stable code, and an unknown one to a generic failure", () => {
    const failures = {
      CART_INSUFFICIENT_STOCK: "insufficient-stock",
      CART_VARIANT_REQUIRED: "variant-required",
      CART_VARIANT_NOT_FOUND: "variant-not-found",
      CART_ITEM_NOT_FOUND: "item-not-found",
      CART_ITEM_UNAVAILABLE: "item-unavailable",
      CART_PRICE_CHANGED: "price-changed",
      CART_LIMIT_REACHED: "limit-reached",
      PRODUCT_NOT_FOUND: "product-not-found",
      SOMETHING_NEW: "error",
    }
    for (const [code, failure] of Object.entries(failures)) {
      assert.deepEqual(interpretCartResult({ kind: "error", status: 409, code }), { state: "failed", failure }, code)
    }
    assert.deepEqual(interpretCartResult({ kind: "error", status: 500, code: null }), { state: "failed", failure: "error" })
  })
})

describe("quantityControls", () => {
  it("steps by one, and never below one: removing is its own action", () => {
    assert.deepEqual(quantityControls(item({ quantity: 3 })), { decreaseTo: 2, increaseTo: 4, correctTo: null })
    assert.deepEqual(quantityControls(item({ quantity: 1 })), { decreaseTo: null, increaseTo: 2, correctTo: null })
  })

  it("offers only the available quantity when a line is above the stock", () => {
    const short = item({ quantity: 5, purchasable: false, issues: [{ code: "INSUFFICIENT_STOCK", availableQuantity: 2 }] })
    assert.deepEqual(quantityControls(short), { decreaseTo: 2, increaseTo: null, correctTo: 2 })
  })

  it("offers nothing on a sold-out line", () => {
    const soldOut = item({ purchasable: false, issues: [{ code: "INSUFFICIENT_STOCK", availableQuantity: 0 }] })
    assert.deepEqual(quantityControls(soldOut), { decreaseTo: null, increaseTo: null, correctTo: null })
  })

  it("offers nothing on a remove-only line", () => {
    for (const code of ["SHOP_UNAVAILABLE", "PRODUCT_ARCHIVED", "PRODUCT_UNPUBLISHED", "VARIANT_UNAVAILABLE"] as const) {
      assert.deepEqual(quantityControls(item({ purchasable: false, issues: [{ code }] })), { decreaseTo: null, increaseTo: null, correctTo: null }, code)
    }
  })

  it("keeps normal controls when only the price changed", () => {
    assert.deepEqual(quantityControls(item({ quantity: 2, issues: [{ code: "PRICE_CHANGED", previousPrice: "1.00" }] })), { decreaseTo: 1, increaseTo: 3, correctTo: null })
  })
})

describe("line display rules", () => {
  it("links to the product only while its page exists", () => {
    assert.equal(canOpenProduct(item()), true)
    assert.equal(canOpenProduct(item({ issues: [{ code: "VARIANT_UNAVAILABLE" }] })), true)
    assert.equal(canOpenProduct(item({ issues: [{ code: "INSUFFICIENT_STOCK", availableQuantity: 0 }] })), true)
    for (const code of ["SHOP_UNAVAILABLE", "PRODUCT_ARCHIVED", "PRODUCT_UNPUBLISHED"] as const) {
      assert.equal(canOpenProduct(item({ issues: [{ code }] })), false, code)
    }
  })

  it("acknowledges the current price, never the previous one", () => {
    assert.equal(priceToAccept(item()), null)
    assert.equal(priceToAccept(item({ unitPrice: "150.00", issues: [{ code: "PRICE_CHANGED", previousPrice: "100.00" }] })), "150.00")
  })

  it("says when lines are left out of the subtotal", () => {
    assert.equal(hasExcludedItems(cart([item()])), false)
    assert.equal(hasExcludedItems(cart([item(), item({ id: "i2", purchasable: false })])), true)
  })

  it("caps the badge", () => {
    assert.equal(cartBadge(1), "1")
    assert.equal(cartBadge(99), "99")
    assert.equal(cartBadge(100), "99+")
  })
})

describe("cart messages", () => {
  const issues: CartItemIssue[] = [
    { code: "SHOP_UNAVAILABLE" },
    { code: "PRODUCT_ARCHIVED" },
    { code: "PRODUCT_UNPUBLISHED" },
    { code: "VARIANT_UNAVAILABLE" },
    { code: "INSUFFICIENT_STOCK", availableQuantity: 2 },
    { code: "INSUFFICIENT_STOCK", availableQuantity: 0 },
    { code: "PRICE_CHANGED", previousPrice: "1000.00" },
  ]

  it("has the same keys in both languages", () => {
    assert.deepEqual(Object.keys(CART_MESSAGES.ar).sort(), Object.keys(CART_MESSAGES.fr).sort())
    assert.deepEqual(Object.keys(CART_MESSAGES.ar.failures).sort(), Object.keys(CART_MESSAGES.fr.failures).sort())
  })

  it("explains every issue in each language, without leaving a placeholder", () => {
    for (const locale of ["fr", "ar"] as const) {
      const texts = issues.map((issue) => issueText(issue, "1500.00", CART_MESSAGES[locale], locale))
      assert.equal(new Set(texts).size, issues.length, locale)
      for (const text of texts) assert.equal(text.includes("{"), false, text)
    }
  })

  it("states both prices in MRU formatting", () => {
    const issue: CartItemIssue = { code: "PRICE_CHANGED", previousPrice: "1000.00" }
    assert.equal(issueText(issue, "1500.50", CART_MESSAGES.fr, "fr"), "Le prix a changé : 1 000,00 MRU auparavant, 1 500,50 MRU maintenant.")
    assert.ok(issueText(issue, "1500.50", CART_MESSAGES.ar, "ar").includes("1,500.50 أوقية"))
  })

  it("states the available quantity", () => {
    assert.ok(issueText({ code: "INSUFFICIENT_STOCK", availableQuantity: 3 }, "1.00", CART_MESSAGES.fr, "fr").includes("3"))
  })
})

describe("approved decision: conditional stock visibility", () => {
  const short = item({ id: "short", quantity: 5, purchasable: false, issues: [{ code: "INSUFFICIENT_STOCK", availableQuantity: 2 }] })
  const fine = item({ id: "fine", quantity: 5 })

  it("offers a correction only on the affected line", () => {
    assert.equal(quantityControls(short).correctTo, 2)
    assert.equal(quantityControls(fine).correctTo, null)
  })

  it("keeps the requested quantity: working out the controls changes nothing", () => {
    quantityControls(short)
    assert.equal(short.quantity, 5)
  })

  it("sends only the new quantity when correcting, never a stock figure", () => {
    const { correctTo } = quantityControls(short)
    assert.ok(correctTo !== null)
    assert.deepEqual(JSON.parse(String(setQuantityRequest(short.id, correctTo).init.body)), { quantity: 2 })
  })

  it("states a figure only for insufficient stock, and none when sold out", () => {
    const withFigure = /\d/
    for (const locale of ["fr", "ar"] as const) {
      const t = CART_MESSAGES[locale]
      assert.match(issueText({ code: "INSUFFICIENT_STOCK", availableQuantity: 2 }, "1.00", t, locale), withFigure)
      assert.doesNotMatch(issueText({ code: "INSUFFICIENT_STOCK", availableQuantity: 0 }, "1.00", t, locale), withFigure)
      for (const code of ["SHOP_UNAVAILABLE", "PRODUCT_ARCHIVED", "PRODUCT_UNPUBLISHED", "VARIANT_UNAVAILABLE"] as const) {
        assert.doesNotMatch(issueText({ code }, "1.00", t, locale), withFigure, code)
      }
    }
  })
})

describe("approved decision: accepting a changed price", () => {
  it("acknowledges what the server last reported, so a newer read replaces it", () => {
    const seen = item({ unitPrice: "150.00", issues: [{ code: "PRICE_CHANGED", previousPrice: "100.00" }] })
    const newer = item({ unitPrice: "200.00", issues: [{ code: "PRICE_CHANGED", previousPrice: "100.00" }] })
    assert.equal(priceToAccept(seen), "150.00")
    assert.equal(priceToAccept(newer), "200.00")
  })

  it("explains a stale acceptance", () => {
    assert.deepEqual(interpretCartResult({ kind: "error", status: 409, code: "CART_PRICE_CHANGED" }), { state: "failed", failure: "price-changed" })
    assert.ok(CART_MESSAGES.fr.failures["price-changed"].length > 0)
    assert.ok(CART_MESSAGES.ar.failures["price-changed"].length > 0)
  })

  it("sends nothing but the price shown", () => {
    assert.deepEqual(Object.keys(JSON.parse(String(acceptPriceRequest("i1", "150.00").init.body))), ["price"])
  })
})
