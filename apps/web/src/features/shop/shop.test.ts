import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { OwnerShopResponse } from "@chicman/shared"

import { classifyResponse } from "../../lib/api-client"
import { availableDecisions, buildDecision, interpretAdminResult, reasonFieldFor } from "../admin/admin-shops"
import { ADMIN_MESSAGES } from "../admin/messages"
import { uploadShopLogo } from "./logo-upload"
import { SHOP_MESSAGES } from "./messages"
import {
  buildChangeRequest,
  buildShopCreate,
  buildShopUpdate,
  directlyEditableFields,
  emptyShopForm,
  interpretShopResult,
  mergeShopFormValues,
  shopFormValues,
} from "./shop-form"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const shop: OwnerShopResponse = {
  id: "s1",
  status: "APPROVED",
  shopName: "Maison Lalla",
  description: "Voiles",
  contactPhone: "+22236000001",
  whatsappPhone: null,
  city: "Nouakchott",
  address: "Ksar",
  logoUrl: null,
  createdAt: "2026-11-07T10:00:00.000Z",
  updatedAt: "2026-11-07T10:00:00.000Z",
  latestDecision: { type: "APPLICATION_APPROVED", decidedAt: "2026-11-07T11:00:00.000Z" },
  rejection: null,
  changeRequest: null,
}

const filled = { shopName: " Maison ", description: "Voiles\r\nmelhfas", contactPhone: "36 00 00 01", whatsappPhone: "", city: "Atar", address: "Centre" }

describe("shop application form (spec 06)", () => {
  it("builds the initial application with the shared rules (normalized, no logo, no protected field)", () => {
    assert.deepEqual(buildShopCreate(filled), {
      ok: true,
      body: { shopName: "Maison", description: "Voiles\nmelhfas", contactPhone: "+22236000001", city: "Atar", address: "Centre" },
    })
    const withWhatsapp = buildShopCreate({ ...filled, whatsappPhone: "46000001" })
    assert.equal(withWhatsapp.ok && withWhatsapp.body.whatsappPhone, "+22246000001")
  })

  it("a refreshed shop updates untouched fields and keeps unsaved edits", () => {
    const before = shopFormValues(shop)
    const typed = { ...before, address: "Non enregistrée" }
    const after = shopFormValues({ ...shop, description: "Nouvelle", address: "Serveur" })
    assert.deepEqual(mergeShopFormValues(typed, before, after), { ...after, address: "Non enregistrée" })
  })

  it("reports each invalid field", () => {
    assert.deepEqual(buildShopCreate(emptyShopForm()), {
      ok: false,
      errors: { shopName: "required", description: "required", contactPhone: "invalidPhone", city: "required", address: "required" },
    })
    const result = buildShopCreate({ ...filled, shopName: "x".repeat(101), city: "A\u0007", whatsappPhone: "12" })
    assert.deepEqual(result, { ok: false, errors: { shopName: "tooLong", city: "invalid", whatsappPhone: "invalidPhone" } })
  })

  it("edits all fields while PENDING/REJECTED, only immediate fields while APPROVED, none while SUSPENDED", () => {
    assert.deepEqual(directlyEditableFields("PENDING"), ["shopName", "description", "contactPhone", "whatsappPhone", "city", "address"])
    assert.deepEqual(directlyEditableFields("APPROVED"), ["description", "contactPhone", "whatsappPhone", "address"])
    assert.deepEqual(directlyEditableFields("SUSPENDED"), [])
  })

  it("sends only changed, allowed fields; shopName/city never go in an approved shop's PATCH", () => {
    const values = { ...shopFormValues(shop), shopName: "Autre", city: "Atar", description: "Nouvelle", whatsappPhone: "46000001" }
    assert.deepEqual(buildShopUpdate(values, shop), { ok: true, body: { description: "Nouvelle", whatsappPhone: "+22246000001" } })
    assert.deepEqual(buildShopUpdate(shopFormValues(shop), shop), { ok: true, body: {} })
    assert.deepEqual(buildShopUpdate({ ...values, shopName: "Autre" }, { ...shop, status: "PENDING" }), {
      ok: true,
      body: { shopName: "Autre", description: "Nouvelle", whatsappPhone: "+22246000001", city: "Atar" },
    })
    const cleared = buildShopUpdate({ ...shopFormValues({ ...shop, whatsappPhone: "+22246000001" }), whatsappPhone: " " }, { ...shop, whatsappPhone: "+22246000001" })
    assert.deepEqual(cleared, { ok: true, body: { whatsappPhone: null } })
  })

  it("a change request carries only the values that differ from the approved ones", () => {
    assert.deepEqual(buildChangeRequest({ shopName: "Maison Lalla", city: "Rosso" }, shop), { ok: true, body: { city: "Rosso" } })
    assert.deepEqual(buildChangeRequest({ shopName: "Maison Lalla", city: "Nouakchott" }, shop), { ok: true, body: {} })
    assert.deepEqual(buildChangeRequest({ shopName: "", city: "Rosso" }, shop), { ok: false, errors: { shopName: "required" } })
  })

  it("interprets API outcomes", async () => {
    assert.deepEqual(interpretShopResult(await classifyResponse(json(404, { error: { code: "SHOP_NOT_FOUND" } }))), { state: "no-shop" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(409, { error: { code: "SHOP_ALREADY_EXISTS" } }))), { state: "already-exists" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(409, { error: { code: "CHANGE_REQUEST_OPEN" } }))), { state: "change-request-open" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(409, { error: { code: "SHOP_STATUS_CONFLICT" } }))), { state: "conflict" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(400, { error: { code: "REVIEW_FIELD_NOT_EDITABLE" } }))), { state: "review-field" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(403, { error: { code: "FORBIDDEN" } }))), { state: "forbidden" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(401, {}))), { state: "signed-out" })
    assert.deepEqual(interpretShopResult(await classifyResponse(json(503, { error: { code: "SERVICE_UNAVAILABLE" } }))), { state: "unavailable" })
  })

  it("has the same message keys in French and Arabic", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, child]) => (typeof child === "object" ? keys(child).map((k) => `${key}.${k}`) : [key]))
    assert.deepEqual(keys(SHOP_MESSAGES.ar).sort(), keys(SHOP_MESSAGES.fr).sort())
    assert.deepEqual(keys(ADMIN_MESSAGES.ar).sort(), keys(ADMIN_MESSAGES.fr).sort())
  })
})

describe("shop logo upload client (spec 06)", () => {
  const png = (size = 10) => new File([new Uint8Array(size)], "logo.png", { type: "image/png" })

  function fakeFetch(handlers: ((url: string, init: RequestInit) => Response)[]) {
    const calls: { url: string; init: RequestInit }[] = []
    const impl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input)
      calls.push({ url, init })
      const handler = handlers.shift()
      if (!handler) throw new Error(`unexpected request ${url}`)
      return handler(url, init)
    }) as typeof fetch
    return { impl, calls }
  }

  const deps = (fetchImpl: typeof fetch) => ({ getAccessToken: async () => "token", fetchImpl, sleep: async () => undefined })
  const uploadResponse = {
    uploadId: "u1",
    uploadUrl: "http://storage.test/chicman-uploads/shop-logos/s1/u1?X-Amz-Signature=x",
    method: "PUT",
    headers: { "Content-Type": "image/png", "Content-Length": "10" },
    expiresAt: "2026-11-07T10:05:00.000Z",
  }

  it("refuses unsupported types and files over 15 MB before any request", async () => {
    const { impl, calls } = fakeFetch([])
    assert.deepEqual(await uploadShopLogo(new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }), deps(impl)), { state: "unsupported-type" })
    assert.deepEqual(await uploadShopLogo(png(15_728_641), deps(impl)), { state: "too-large" })
    assert.equal(calls.length, 0)
  })

  it("requests the upload, PUTs the file to the presigned URL, then completes", async () => {
    const { impl, calls } = fakeFetch([
      () => json(201, uploadResponse),
      () => new Response(null, { status: 200 }),
      () => json(409, { error: { code: "LOGO_COMPLETION_IN_PROGRESS" } }),
      () => json(200, { logoUrl: "http://media.test/shop-logos/s1/u1/o1.png" }),
    ])
    const outcome = await uploadShopLogo(png(), deps(impl))
    assert.deepEqual(outcome, { state: "ok", logoUrl: "http://media.test/shop-logos/s1/u1/o1.png" })
    assert.equal(calls[0]?.url, "http://localhost:4000/api/v1/sellers/me/shop/logo/uploads")
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { contentType: "image/png", contentLength: 10 })
    assert.equal(calls[1]?.url, uploadResponse.uploadUrl)
    assert.equal(calls[1]?.init.method, "PUT")
    // The token is never sent to storage.
    assert.deepEqual(calls[1]?.init.headers, { "Content-Type": "image/png" })
    assert.equal(calls[2]?.url, "http://localhost:4000/api/v1/sellers/me/shop/logo/uploads/u1/complete")
  })

  it("maps verification failures and expired uploads", async () => {
    for (const [status, code, expected] of [
      [422, "LOGO_TOO_LARGE_DIMENSIONS", { state: "rejected", code: "LOGO_TOO_LARGE_DIMENSIONS" }],
      [422, "LOGO_UNSUPPORTED_TYPE", { state: "rejected", code: "LOGO_UNSUPPORTED_TYPE" }],
      [410, "LOGO_UPLOAD_EXPIRED", { state: "expired" }],
      [403, "FORBIDDEN", { state: "forbidden" }],
    ] as const) {
      const { impl } = fakeFetch([() => json(201, uploadResponse), () => new Response(null, { status: 200 }), () => json(status, { error: { code } })])
      assert.deepEqual(await uploadShopLogo(png(), deps(impl)), expected)
    }
    const { impl } = fakeFetch([() => json(403, { error: { code: "FORBIDDEN" } })])
    assert.deepEqual(await uploadShopLogo(png(), deps(impl)), { state: "forbidden" })
  })
})

describe("admin shop decisions (spec 06)", () => {
  it("offers only the transitions allowed from each status", () => {
    assert.deepEqual(availableDecisions("PENDING"), ["approve", "reject"])
    assert.deepEqual(availableDecisions("APPROVED"), ["suspend"])
    assert.deepEqual(availableDecisions("SUSPENDED"), ["reinstate"])
    assert.deepEqual(availableDecisions("REJECTED"), [])
  })

  it("an application rejection asks for applicantReason only; every other decision for internalReason", () => {
    assert.equal(reasonFieldFor("reject"), "applicantReason")
    for (const action of ["approve", "suspend", "reinstate"] as const) assert.equal(reasonFieldFor(action), "internalReason")
    assert.deepEqual(buildDecision("reject", " Adresse incomplète ", ""), { ok: true, body: { applicantReason: "Adresse incomplète" } })
    assert.deepEqual(buildDecision("approve", "Documents vérifiés", "note"), {
      ok: true,
      body: { internalReason: "Documents vérifiés", internalNote: "note" },
    })
    assert.deepEqual(buildDecision("change-request", "Nom conforme ok", ""), { ok: true, body: { internalReason: "Nom conforme ok" } })
  })

  it("a 403 for the administrator's own shop is told apart from a missing ADMIN role", async () => {
    assert.deepEqual(
      interpretAdminResult(await classifyResponse(json(403, { error: { code: "SHOP_SELF_ADMINISTRATION_FORBIDDEN" } }))),
      { state: "own-shop" }
    )
    assert.deepEqual(interpretAdminResult(await classifyResponse(json(403, { error: { code: "FORBIDDEN" } }))), { state: "forbidden" })
  })

  it("enforces the 10–500 reason and 1000 note bounds", () => {
    assert.deepEqual(buildDecision("suspend", "court", ""), { ok: false, errors: { reason: "reasonLength" } })
    assert.deepEqual(buildDecision("suspend", "x".repeat(501), "y".repeat(1001)), {
      ok: false,
      errors: { reason: "reasonLength", internalNote: "noteLength" },
    })
    assert.deepEqual(buildDecision("reject", "Motif avec\u0007bip", ""), { ok: false, errors: { reason: "reasonInvalid" } })
  })
})
