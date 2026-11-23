import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  adminModerationCaseListQuerySchema,
  adminOrderListQuerySchema,
  adminProductListQuerySchema,
  PRODUCT_MODERATION_REASONS,
  PRODUCT_MODERATION_STATUSES,
  PRODUCT_REPORT_REASONS,
  type SellerProductDetail,
} from "@chicman/shared"

import { MODERATION_MESSAGES } from "./messages"
import {
  adminCaseListPath,
  adminProductActionPath,
  adminProductListPath,
  adminProductOrdersPath,
  availableModerationActions,
  buildDismiss,
  buildReport,
  buildRestore,
  buildResubmit,
  buildSanction,
  CASE_QUEUE_FILTERS,
  interpretReportResult,
  OPEN_ORDER_STATUSES,
  sellerModerationFilter,
  sellerModerationRules,
  SELLER_MODERATION_FILTERS,
} from "./moderation"

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111"
const SHOP_ID = "5b4dccd0-fba3-4af5-93be-4ed8f5aff1c3"
const query = (path: string) => Object.fromEntries(new URLSearchParams(path.split("?")[1]))

const MESSAGE = "La description ne correspond pas aux photos."
const INTERNAL = "Vérifié par l'équipe de modération."

describe("admin moderation requests (spec 19)", () => {
  it("builds product list queries the API accepts", () => {
    for (const moderationStatus of [null, ...PRODUCT_MODERATION_STATUSES]) {
      for (const shopId of [null, SHOP_ID]) {
        const path = adminProductListPath({ search: "  robe  ", shopId, moderationStatus }, 2)
        assert.equal(adminProductListQuerySchema.safeParse(query(path)).success, true, path)
        assert.equal(query(path)["q"], "robe")
      }
    }
    assert.equal(query(adminProductListPath({ search: "  ", shopId: null, moderationStatus: null }, 1))["q"], undefined)
  })

  it("builds queue queries the API accepts for every filter", () => {
    for (const filter of CASE_QUEUE_FILTERS) {
      const path = adminCaseListPath(filter, "sac", 1, SHOP_ID)
      assert.equal(adminModerationCaseListQuerySchema.safeParse(query(path)).success, true, path)
    }
    assert.equal(query(adminCaseListPath("queue", "", 1))["status"], undefined, "the open queue")
    assert.deepEqual(query(adminCaseListPath("IN_REVIEW", "", 1)), { status: "ACTIVE", moderationStatus: "IN_REVIEW", page: "1" })
    assert.equal(query(adminCaseListPath("CLOSED", "", 1))["status"], "CLOSED")
  })

  it("asks the existing order list for open shop orders containing the product", () => {
    for (const status of OPEN_ORDER_STATUSES) {
      assert.equal(adminOrderListQuerySchema.safeParse(query(adminProductOrdersPath(PRODUCT_ID, status))).success, true)
    }
  })

  it("names the action routes", () => {
    assert.equal(adminProductActionPath(PRODUCT_ID, "request-correction"), `/admin/products/${PRODUCT_ID}/moderation/request-correction`)
  })

  it("offers exactly the actions the state allows (section 3.2), none once removed", () => {
    assert.deepEqual(availableModerationActions("CLEAR"), ["restrict", "remove"])
    assert.deepEqual(availableModerationActions("RESTRICTED"), ["restore", "remove"])
    assert.deepEqual(availableModerationActions("IN_REVIEW"), ["restore", "request-correction", "remove"])
    assert.deepEqual(availableModerationActions("REMOVED"), [])
  })

  it("checks each action's reasons with the API's schemas", () => {
    assert.deepEqual(buildSanction("CLEAR", "COUNTERFEIT", MESSAGE, INTERNAL, ""), {
      ok: true,
      body: { expectedStatus: "CLEAR", sellerReasonCode: "COUNTERFEIT", sellerMessage: MESSAGE, internalReason: INTERNAL },
    })
    const missing = buildSanction("CLEAR", null, "court", "", "")
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.deepEqual(missing.errors, { sellerReasonCode: "required", sellerMessage: "length", internalReason: "length" })
    assert.deepEqual(buildRestore("IN_REVIEW", INTERNAL, "", ""), { ok: true, body: { expectedStatus: "IN_REVIEW", internalReason: INTERNAL } })
    assert.equal(buildRestore("IN_REVIEW", INTERNAL, "court", "").ok, false, "a seller message, when given, is 10–1000")
    assert.deepEqual(buildDismiss(INTERNAL, "Note"), { ok: true, body: { internalReason: INTERNAL, internalNote: "Note" } })
    assert.equal(buildDismiss("court", "").ok, false)
  })
})

describe("seller moderation (spec 19)", () => {
  const product = (status: SellerProductDetail["moderation"]["status"], extra: Partial<Pick<SellerProductDetail, "status" | "images">> = {}) => ({
    moderation: { status, reasonCode: null, message: null, updatedAt: null },
    status: extra.status ?? ("PUBLISHED" as const),
    images: extra.images ?? [{ id: "i", url: "u", position: 0, contentType: "image/png" as const, sizeBytes: 1, width: 1, height: 1 }],
  })

  it("locks edits except stock while in review, everything once removed, and offers resubmission while restricted", () => {
    assert.deepEqual(sellerModerationRules(product("CLEAR")), { moderated: false, stockOnly: false, readOnly: false, canResubmit: false })
    assert.deepEqual(sellerModerationRules(product("RESTRICTED")), { moderated: true, stockOnly: false, readOnly: false, canResubmit: true })
    assert.deepEqual(sellerModerationRules(product("IN_REVIEW")), { moderated: true, stockOnly: true, readOnly: false, canResubmit: false })
    assert.deepEqual(sellerModerationRules(product("REMOVED")), { moderated: true, stockOnly: false, readOnly: true, canResubmit: false })
    assert.equal(sellerModerationRules(product("RESTRICTED", { status: "ARCHIVED" })).canResubmit, false)
    assert.equal(sellerModerationRules(product("RESTRICTED", { images: [] })).canResubmit, false)
  })

  it("reads the overview's filter from the URL, and nothing else", () => {
    for (const filter of SELLER_MODERATION_FILTERS) assert.equal(sellerModerationFilter(filter), filter)
    for (const value of [undefined, "CLEAR", "restricted", ["RESTRICTED"]]) assert.equal(sellerModerationFilter(value), null)
  })

  it("sends an empty body or the note", () => {
    assert.deepEqual(buildResubmit("  "), { ok: true, body: {} })
    assert.deepEqual(buildResubmit("Photos remplacées"), { ok: true, body: { note: "Photos remplacées" } })
    assert.equal(buildResubmit("x".repeat(501)).ok, false)
  })
})

describe("buyer report (spec 19, section 4)", () => {
  it("needs a reason, and a description with OTHER", () => {
    assert.deepEqual(buildReport(PRODUCT_ID, null, ""), { ok: false, error: "reasonRequired" })
    assert.deepEqual(buildReport(PRODUCT_ID, "OTHER", "  "), { ok: false, error: "detailsRequired" })
    assert.deepEqual(buildReport(PRODUCT_ID, "COUNTERFEIT", ""), { ok: true, body: { productId: PRODUCT_ID, reasonCode: "COUNTERFEIT" } })
    assert.deepEqual(buildReport(PRODUCT_ID, "OTHER", "Vendu d'occasion"), {
      ok: true,
      body: { productId: PRODUCT_ID, reasonCode: "OTHER", details: "Vendu d'occasion" },
    })
    assert.deepEqual(buildReport(PRODUCT_ID, "NOT_NEW", "x".repeat(1001)), { ok: false, error: "detailsLength" })
    assert.deepEqual(buildReport(PRODUCT_ID, "NOT_NEW", "a\u0007b"), { ok: false, error: "detailsInvalid" })
  })

  it("reads a new report and a repeat the same way: sent (PD-4)", () => {
    assert.equal(interpretReportResult({ kind: "ok", status: 201, data: {} }), "sent")
    assert.equal(interpretReportResult({ kind: "ok", status: 200, data: {} }), "sent")
    assert.equal(interpretReportResult({ kind: "unauthorized" }), "sign-in")
    assert.equal(interpretReportResult({ kind: "forbidden", code: "FORBIDDEN" }), "not-allowed")
    assert.equal(interpretReportResult({ kind: "error", status: 404, code: "PRODUCT_NOT_FOUND" }), "not-found")
    assert.equal(interpretReportResult({ kind: "error", status: 400, code: "PRODUCT_REPORT_REASON_INVALID" }), "invalid")
    assert.equal(interpretReportResult({ kind: "error", status: 429, code: "RATE_LIMITED" }), "rate-limited")
  })
})

describe("moderation texts (spec 19)", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    value !== null && typeof value === "object"
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix.slice(0, -1)]

  it("has the same keys in French and Arabic, every one filled", () => {
    assert.deepEqual(keys(MODERATION_MESSAGES.ar).sort(), keys(MODERATION_MESSAGES.fr).sort())
    for (const locale of ["fr", "ar"] as const) {
      for (const key of keys(MODERATION_MESSAGES[locale])) {
        const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], MODERATION_MESSAGES[locale])
        assert.ok(typeof value === "string" && value.trim().length > 0, `${locale} ${key}`)
      }
    }
  })

  it("translates every reason code and state, never showing a raw code", () => {
    for (const locale of ["fr", "ar"] as const) {
      const t = MODERATION_MESSAGES[locale]
      for (const code of PRODUCT_MODERATION_REASONS) assert.notEqual(t.sellerReasons[code], code)
      for (const code of PRODUCT_REPORT_REASONS) assert.notEqual(t.reportReasons[code], code)
      for (const status of PRODUCT_MODERATION_STATUSES) assert.notEqual(t.status[status], status)
    }
  })

  it("shows administrators to sellers as Chicman (PD-10)", () => {
    assert.equal(MODERATION_MESSAGES.fr.seller.actor.CHICMAN, "Chicman")
    assert.equal(MODERATION_MESSAGES.ar.seller.actor.CHICMAN, "شيكمان")
  })

  it("never shows buyers moderation wording in the report flow beyond 'Signalement envoyé'", () => {
    assert.equal(MODERATION_MESSAGES.fr.report.sent, "Signalement envoyé")
    assert.doesNotMatch(JSON.stringify(MODERATION_MESSAGES.fr.report), /restreint|retiré|révision/i)
  })
})
