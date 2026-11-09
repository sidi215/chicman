import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { SHOP_ORDER_LABELS, type CheckoutSummary, type CustomerOrder } from "@chicman/shared"

import { classifyResponse } from "../../lib/api-client"
import {
  addressIdFromQuery,
  canPlace,
  checkoutPathFor,
  interpretPlacementResult,
  interpretSummaryResult,
  keepsAttemptKey,
  needsFreshSummary,
  placementBody,
  placementRequest,
  recipientError,
  summaryPath,
} from "./checkout-logic"
import { CHECKOUT_MESSAGES, problemText } from "./messages"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const error = (status: number, code: string) => json(status, { error: { code } })

const SHOP_A = "11111111-1111-4111-8111-111111111111"
const SHOP_B = "22222222-2222-4222-8222-222222222222"
const ADDRESS = "33333333-3333-4333-8333-333333333333"

function item(id: string, name: string) {
  return {
    id,
    productId: `p-${id}`,
    variantId: null,
    name,
    imageUrl: null,
    size: null,
    color: null,
    quantity: 1,
    unitPrice: "100.00",
    subtotal: "100.00",
    purchasable: true,
    issues: [],
  }
}

const summary: CheckoutSummary = {
  shops: [
    { shop: { id: SHOP_A, name: "Maison Lalla" }, items: [item("i1", "Melhfa")], productsSubtotal: "100.00", deliveryFee: "50.00", total: "150.00" },
    { shop: { id: SHOP_B, name: "Atar Mode" }, items: [item("i2", "Sandales")], productsSubtotal: "100.00", deliveryFee: "0.00", total: "100.00" },
  ],
  itemCount: 2,
  productsSubtotal: "200.00",
  deliveryFeeTotal: "50.00",
  total: "250.00",
  address: {
    addressId: ADDRESS,
    label: null,
    city: "Nouakchott",
    district: "Ksar",
    landmark: "Près du marché",
    deliveryPhone: "+22233000000",
    latitude: 18.08,
    longitude: -15.97,
    locationSource: "MANUAL",
    accuracyMeters: null,
  },
  defaultRecipientName: "Aïcha",
  paymentMethod: "CASH_ON_DELIVERY",
  problems: [],
}

describe("checkout requests (spec 10)", () => {
  it("reads the summary for the chosen address, or the default one", () => {
    assert.equal(summaryPath(null), "/customers/me/checkout")
    assert.equal(summaryPath(ADDRESS), `/customers/me/checkout?addressId=${ADDRESS}`)
    assert.equal(checkoutPathFor(ADDRESS), `/checkout?addressId=${ADDRESS}`)
  })

  it("only takes a UUID from the address link", () => {
    assert.equal(addressIdFromQuery(ADDRESS), ADDRESS)
    assert.equal(addressIdFromQuery([ADDRESS, "x"]), ADDRESS)
    for (const value of [undefined, null, "", "../evil", "https://evil.example", `${ADDRESS}x`]) assert.equal(addressIdFromQuery(value), null, String(value))
  })

  it("sends the shown figures as a precondition, with the attempt's Idempotency-Key", () => {
    const body = placementBody(summary, "Aïcha")
    assert.deepEqual(body, {
      addressId: ADDRESS,
      recipientName: "Aïcha",
      expected: {
        total: "250.00",
        shops: [
          { shopId: SHOP_A, productsSubtotal: "100.00", deliveryFee: "50.00" },
          { shopId: SHOP_B, productsSubtotal: "100.00", deliveryFee: "0.00" },
        ],
      },
    })
    assert.ok(body)
    const { path, init } = placementRequest(body, "key-1")
    assert.equal(path, "/customers/me/checkout")
    assert.equal(init.method, "POST")
    assert.deepEqual(init.headers, { "content-type": "application/json", "Idempotency-Key": "key-1" })
    assert.deepEqual(JSON.parse(String(init.body)), body)
  })

  it("offers placement only without problems, with an address, and with every fee", () => {
    assert.equal(canPlace(summary), true)
    assert.equal(canPlace({ ...summary, problems: [{ code: "CART_EMPTY" }] }), false)
    assert.equal(canPlace({ ...summary, address: null }), false)
    assert.equal(placementBody({ ...summary, address: null }, "Aïcha"), null)
    const unpriced = { ...summary, total: null, shops: [{ ...summary.shops[0]!, deliveryFee: null, total: null }] }
    assert.equal(canPlace(unpriced), false)
  })

  it("checks the recipient name with the API's rule", () => {
    assert.equal(recipientError("Aïcha"), null)
    assert.equal(recipientError("   "), "required")
    assert.equal(recipientError("x".repeat(101)), "tooLong")
    assert.equal(recipientError("Ali\u0007"), "invalid")
  })
})

describe("checkout responses", () => {
  it("reads a summary, the session, and account setup", async () => {
    assert.deepEqual(interpretSummaryResult(await classifyResponse(json(200, summary))), { state: "ok", summary })
    assert.deepEqual(interpretSummaryResult(await classifyResponse(new Response(null, { status: 401 }))), { state: "signed-out" })
    assert.deepEqual(interpretSummaryResult(await classifyResponse(error(403, "FORBIDDEN"))), { state: "not-bootstrapped" })
    assert.deepEqual(interpretSummaryResult(await classifyResponse(error(404, "ADDRESS_NOT_FOUND"))), { state: "failed", failure: "address-not-found" })
  })

  it("treats 201 and 200 (a repeated key) alike: the order exists", async () => {
    const order = { id: "o1", reference: "CM-ABC" } as CustomerOrder
    assert.deepEqual(interpretPlacementResult(await classifyResponse(json(201, order))), { state: "placed", order })
    assert.deepEqual(interpretPlacementResult(await classifyResponse(json(200, order))), { state: "placed", order })
  })

  it("names each refusal", async () => {
    const cases: [Response, string][] = [
      [error(409, "CHECKOUT_BLOCKED"), "blocked"],
      [error(409, "CHECKOUT_TOTALS_CHANGED"), "totals-changed"],
      [error(409, "CHECKOUT_CART_EMPTY"), "cart-empty"],
      [error(404, "ADDRESS_NOT_FOUND"), "address-not-found"],
      [error(400, "CHECKOUT_IDEMPOTENCY_KEY_INVALID"), "invalid"],
      [error(429, "RATE_LIMITED"), "rate-limited"],
      [error(503, "SERVICE_UNAVAILABLE"), "unavailable"],
      [error(500, "INTERNAL_ERROR"), "error"],
    ]
    for (const [response, failure] of cases) {
      assert.deepEqual(interpretPlacementResult(await classifyResponse(response)), { state: "failed", failure }, failure)
    }
    assert.deepEqual(interpretPlacementResult({ kind: "network-error" }), { state: "failed", failure: "unavailable" })
  })

  it("keeps the attempt's key only while the outcome is unknown, and reads the summary again after a change", () => {
    assert.equal(keepsAttemptKey("unavailable"), true)
    for (const failure of ["blocked", "totals-changed", "cart-empty", "address-not-found", "invalid", "rate-limited", "error"] as const) {
      assert.equal(keepsAttemptKey(failure), false, failure)
    }
    for (const failure of ["blocked", "totals-changed", "cart-empty", "address-not-found"] as const) assert.equal(needsFreshSummary(failure), true, failure)
    for (const failure of ["unavailable", "rate-limited", "invalid", "error"] as const) assert.equal(needsFreshSummary(failure), false, failure)
  })
})

describe("checkout texts", () => {
  it("has the same keys in French and Arabic, with every shop order label", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, child]) => (typeof child === "object" && child !== null ? keys(child).map((sub) => `${key}.${sub}`) : [key])).sort()
    assert.deepEqual(keys(CHECKOUT_MESSAGES.ar), keys(CHECKOUT_MESSAGES.fr))
    for (const locale of ["fr", "ar"] as const) for (const label of SHOP_ORDER_LABELS) assert.ok(CHECKOUT_MESSAGES[locale].labels[label], `${locale} ${label}`)
    assert.equal(CHECKOUT_MESSAGES.fr.labels.AWAITING_SHOP, "En attente de la boutique")
  })

  it("names the shop or the line each problem concerns", () => {
    const t = CHECKOUT_MESSAGES.fr
    assert.match(problemText({ code: "DELIVERY_FEE_NOT_SET", shopId: SHOP_B }, summary, t), /^Atar Mode n'a pas encore/)
    assert.match(problemText({ code: "OWN_SHOP", shopId: SHOP_A }, summary, t), /\(Maison Lalla\)/)
    assert.match(problemText({ code: "PRICE_CHANGED", shopId: SHOP_A, itemId: "i1" }, summary, t), /« Melhfa »/)
    assert.match(problemText({ code: "INSUFFICIENT_STOCK", shopId: SHOP_B, itemId: "i2" }, summary, t), /« Sandales »/)
    assert.match(problemText({ code: "PRODUCT_ARCHIVED", shopId: SHOP_B, itemId: "i2" }, summary, t), /ne peut plus être acheté/)
    assert.equal(problemText({ code: "CART_EMPTY" }, summary, CHECKOUT_MESSAGES.ar), "سلتك فارغة.")
  })

  it("never calls the delivery phone verified", () => {
    for (const locale of ["fr", "ar"] as const) {
      const { deliveryPhone, phoneHint, shopContact, whatsapp } = CHECKOUT_MESSAGES[locale]
      assert.equal(/vérifi|موثق|تحقق/i.test([deliveryPhone, phoneHint, shopContact, whatsapp].join(" ")), false, locale)
    }
  })
})
