import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  CUSTOMER_CANCELLATION_REASONS,
  DELIVERY_FAILURE_REASONS,
  DELIVERY_STATUSES,
  SELLER_CANCELLATION_REASONS,
  SHOP_ORDER_LABELS,
  SHOP_ORDER_STATUSES,
  SYSTEM_CANCELLATION_REASONS,
  type ShopOrderReasonCode,
} from "@chicman/shared"

import { classifyResponse } from "../../lib/api-client"
import { DELIVERY_FAILURE_TEXT, ORDER_MESSAGES, SHOP_ORDER_LABEL_TEXT } from "./messages"
import {
  accountOrderHref,
  customerCancellationBody,
  customerCancelPath,
  customerDecisionText,
  defaultSummaryPeriod,
  deliveredBody,
  deliveryActionPath,
  failBody,
  IN_PROGRESS_DELIVERIES_PATH,
  interpretOrderResult,
  listQuery,
  needsReload,
  pageCount,
  paymentSummaryPath,
  sellerActionPath,
  sellerDecisionText,
  showsDeadline,
  showsReturnsNotice,
  summaryPeriodError,
} from "./order-logic"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const error = (status: number, code: string) => json(status, { error: { code } })

describe("order paths", () => {
  it("builds the API and page paths, encoding IDs", () => {
    assert.equal(customerCancelPath("o 1", "s/2"), "/customers/me/orders/o%201/shop-orders/s%2F2/cancel")
    assert.equal(sellerActionPath("abc", "reject"), "/sellers/me/orders/abc/reject")
    assert.equal(accountOrderHref("abc"), "/account/orders/abc")
    assert.equal(listQuery(2), "?page=2")
    assert.equal(listQuery(1, "PENDING"), "?page=1&status=PENDING")
    assert.equal(pageCount(0, 20), 1)
    assert.equal(pageCount(41, 20), 3)
  })
})

describe("order results", () => {
  it("maps the API's answers to what the page shows", async () => {
    const outcome = async (response: Response) => interpretOrderResult(await classifyResponse(response))
    assert.deepEqual(await outcome(json(200, { ok: true })), { state: "ok", data: { ok: true } })
    assert.deepEqual(await outcome(new Response(null, { status: 401 })), { state: "signed-out" })
    assert.deepEqual(await outcome(error(403, "FORBIDDEN")), { state: "failed", failure: "forbidden" })
    assert.deepEqual(await outcome(error(404, "ORDER_NOT_FOUND")), { state: "failed", failure: "not-found" })
    assert.deepEqual(await outcome(error(404, "SHOP_ORDER_NOT_FOUND")), { state: "failed", failure: "not-found" })
    assert.deepEqual(await outcome(error(409, "SHOP_ORDER_STATUS_CONFLICT")), { state: "failed", failure: "conflict" })
    assert.deepEqual(await outcome(error(409, "SHOP_ORDER_EXPIRED")), { state: "failed", failure: "expired" })
    assert.deepEqual(await outcome(error(400, "BAD_REQUEST")), { state: "failed", failure: "invalid" })
    assert.deepEqual(await outcome(error(429, "RATE_LIMITED")), { state: "failed", failure: "rate-limited" })
    assert.deepEqual(await outcome(error(503, "SERVICE_UNAVAILABLE")), { state: "failed", failure: "unavailable" })
    assert.deepEqual(interpretOrderResult({ kind: "network-error" }), { state: "failed", failure: "unavailable" })
    assert.deepEqual(await outcome(error(500, "INTERNAL_ERROR")), { state: "failed", failure: "error" })
  })

  it("reloads the shown state after a conflict or an expiry only", () => {
    assert.equal(needsReload("conflict"), true)
    assert.equal(needsReload("expired"), true)
    for (const failure of ["not-found", "forbidden", "invalid", "rate-limited", "unavailable", "error"] as const) assert.equal(needsReload(failure), false)
  })
})

describe("customer cancellation body", () => {
  it("sends no reason, a reason, or OTHER with its text, as the API's schema requires", () => {
    assert.deepEqual(customerCancellationBody(null, "ignored"), { body: {} })
    assert.deepEqual(customerCancellationBody("CHANGED_MIND", "ignored"), { body: { reason: "CHANGED_MIND" } })
    assert.deepEqual(customerCancellationBody("OTHER", "  Trop long  "), { body: { reason: "OTHER", reasonText: "Trop long" } })
  })

  it("refuses a missing, short, long, or invalid explanation with OTHER", () => {
    assert.deepEqual(customerCancellationBody("OTHER", "   "), { error: "required" })
    assert.deepEqual(customerCancellationBody("OTHER", "ab"), { error: "tooShort" })
    assert.deepEqual(customerCancellationBody("OTHER", "x".repeat(201)), { error: "tooLong" })
    assert.deepEqual(customerCancellationBody("OTHER", "abc\u0007"), { error: "invalid" })
  })
})

describe("decisions", () => {
  it("shows the customer the seller's or system's reason, or Chicman, and nothing of their own", () => {
    assert.deepEqual(customerDecisionText({ cancelledBy: null, reason: "OUT_OF_STOCK" }), { kind: "reason", code: "OUT_OF_STOCK" })
    assert.deepEqual(customerDecisionText({ cancelledBy: "SYSTEM", reason: "SHOP_UNAVAILABLE" }), { kind: "reason", code: "SHOP_UNAVAILABLE" })
    assert.deepEqual(customerDecisionText({ cancelledBy: "CHICMAN", reason: null }), { kind: "chicman" })
    assert.equal(customerDecisionText({ cancelledBy: "CUSTOMER", reason: null }), null)
    assert.equal(customerDecisionText({ cancelledBy: null, reason: null }), null)
  })

  it("shows the seller who cancelled, the code, and a customer's text", () => {
    assert.deepEqual(sellerDecisionText({ cancelledBy: "CUSTOMER", reason: "OTHER", reasonText: "<b>bonjour</b>" }), {
      kind: "by-customer",
      code: "OTHER",
      text: "<b>bonjour</b>",
    })
    assert.deepEqual(sellerDecisionText({ cancelledBy: "SELLER", reason: "CUSTOMER_REQUESTED", reasonText: null }), { kind: "by-seller", code: "CUSTOMER_REQUESTED" })
    assert.deepEqual(sellerDecisionText({ cancelledBy: "CHICMAN", reason: null, reasonText: null }), { kind: "chicman" })
    assert.deepEqual(sellerDecisionText({ cancelledBy: null, reason: "PRICE_ERROR", reasonText: null }), { kind: "reason", code: "PRICE_ERROR" })
  })

  it("shows the returns sentence on delivered shop orders only, and the deadline while pending", () => {
    for (const status of SHOP_ORDER_STATUSES) {
      assert.equal(showsReturnsNotice(status), status === "DELIVERED")
      assert.equal(showsDeadline(status), status === "PENDING")
    }
  })
})

describe("order messages", () => {
  const keys = (value: object): string[] =>
    Object.entries(value).flatMap(([key, child]) => (typeof child === "object" && child !== null ? keys(child).map((sub) => `${key}.${sub}`) : [key])).sort()

  it("has the same keys in French and Arabic", () => {
    assert.deepEqual(keys(ORDER_MESSAGES.ar), keys(ORDER_MESSAGES.fr))
  })

  it("translates every label, status, and reason code", () => {
    const codes: ShopOrderReasonCode[] = [...SELLER_CANCELLATION_REASONS, ...CUSTOMER_CANCELLATION_REASONS, ...SYSTEM_CANCELLATION_REASONS]
    for (const locale of ["fr", "ar"] as const) {
      for (const label of SHOP_ORDER_LABELS) assert.ok(SHOP_ORDER_LABEL_TEXT[locale][label])
      for (const status of SHOP_ORDER_STATUSES) assert.ok(ORDER_MESSAGES[locale].statusFilter[status])
      for (const code of codes) assert.ok(ORDER_MESSAGES[locale].reasons[code], `${locale} ${code}`)
    }
    assert.equal(ORDER_MESSAGES.fr.cancelledByChicman, "Annulée par Chicman")
    assert.equal(ORDER_MESSAGES.ar.cancelledByChicman, "ألغتها شيكمان")
    assert.equal(SHOP_ORDER_LABEL_TEXT.fr.EXPIRED, "Expirée (sans réponse de la boutique)")
  })
})

describe("seller delivery (spec 12)", () => {
  it("builds the delivery action paths, encoding IDs", () => {
    assert.equal(deliveryActionPath("a/b", "delivered"), "/sellers/me/orders/a%2Fb/delivery/delivered")
    for (const action of ["ready", "dispatch", "fail", "close"] as const) assert.equal(deliveryActionPath("x", action), `/sellers/me/orders/x/delivery/${action}`)
    assert.equal(IN_PROGRESS_DELIVERIES_PATH, "/sellers/me/deliveries/in-progress")
  })

  it("sends the shown amount as a string and a reason from the fixed list", () => {
    assert.deepEqual(deliveredBody("3100.00"), { amount: "3100.00" })
    assert.deepEqual(failBody("CUSTOMER_ABSENT"), { reason: "CUSTOMER_ABSENT" })
  })

  it("maps delivery conflicts and a changed amount to a reload", async () => {
    const conflict = interpretOrderResult(await classifyResponse(error(409, "DELIVERY_STATUS_CONFLICT")))
    assert.deepEqual(conflict, { state: "failed", failure: "conflict" })
    const mismatch = interpretOrderResult(await classifyResponse(error(409, "PAYMENT_AMOUNT_MISMATCH")))
    assert.deepEqual(mismatch, { state: "failed", failure: "amount-mismatch" })
    assert.equal(needsReload("amount-mismatch"), true)
    assert.equal(needsReload("forbidden"), false)
  })

  it("translates every failure reason and delivery status in French and Arabic", () => {
    for (const locale of ["fr", "ar"] as const) {
      for (const reason of DELIVERY_FAILURE_REASONS) {
        assert.ok(DELIVERY_FAILURE_TEXT[locale][reason].length > 0, `${locale} ${reason}`)
        assert.equal(ORDER_MESSAGES[locale].deliveryFailureReasons[reason], DELIVERY_FAILURE_TEXT[locale][reason])
      }
      for (const status of DELIVERY_STATUSES) assert.ok(ORDER_MESSAGES[locale].deliveryStatus[status].length > 0, `${locale} ${status}`)
      assert.ok(ORDER_MESSAGES[locale].failures["amount-mismatch"].length > 0)
    }
    assert.notEqual(DELIVERY_FAILURE_TEXT.fr.CUSTOMER_COULD_NOT_PAY, DELIVERY_FAILURE_TEXT.ar.CUSTOMER_COULD_NOT_PAY)
  })
})

describe("seller collection summary (spec 13)", () => {
  it("asks for the current UTC month up to today by default", () => {
    assert.deepEqual(defaultSummaryPeriod(new Date("2026-11-10T23:30:00Z")), { from: "2026-11-01", to: "2026-11-10" })
    assert.deepEqual(defaultSummaryPeriod(new Date("2026-03-01T00:00:00Z")), { from: "2026-03-01", to: "2026-03-01" })
  })

  it("builds the summary path from the period only", () => {
    assert.equal(paymentSummaryPath({ from: "2026-01-01", to: "2026-01-31" }), "/sellers/me/payments/summary?from=2026-01-01&to=2026-01-31")
  })

  it("checks the period with the API's rules before asking", () => {
    assert.equal(summaryPeriodError({ from: "2026-01-01", to: "2026-01-01" }), null)
    assert.equal(summaryPeriodError({ from: "2024-01-01", to: "2024-12-31" }), null)
    assert.equal(summaryPeriodError({ from: "", to: "2026-01-01" }), "required")
    assert.equal(summaryPeriodError({ from: "2026-01-01", to: "" }), "required")
    assert.equal(summaryPeriodError({ from: "2026-02-01", to: "2026-01-31" }), "order")
    assert.equal(summaryPeriodError({ from: "2024-01-01", to: "2025-01-01" }), "tooLong")
  })

  it("has every summary text in both languages", () => {
    for (const locale of ["fr", "ar"] as const) {
      const t = ORDER_MESSAGES[locale]
      for (const error of ["required", "order", "tooLong"] as const) assert.ok(t.summaryErrors[error].length > 0)
      assert.ok(t.summaryPeriod.includes("{from}") && t.summaryPeriod.includes("{to}"))
      assert.ok(t.collectedOn.includes("{amount}") && t.collectedOn.includes("{date}"))
    }
  })
})
