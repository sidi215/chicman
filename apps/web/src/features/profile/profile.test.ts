import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { CustomerProfile } from "@chicman/shared"

import { classifyResponse } from "../../lib/api-client"
import { PROFILE_MESSAGES } from "./messages"
import { buildProfileUpdate, hasChanges, interpretProfileResult, profileFormValues } from "./profile-form"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const stored: CustomerProfile = {
  id: "p1",
  fullName: "Aminetou",
  preferredLocale: "fr",
  phone: "+22222123456",
  createdAt: "2026-11-05T10:00:00.000Z",
  updatedAt: "2026-11-05T10:00:00.000Z",
}

const account = { userId: "u1", roles: ["CUSTOMER"], profile: stored }

describe("profile settings form (spec 04)", () => {
  it("starts from the stored profile", () => {
    assert.deepEqual(profileFormValues({ ...stored, fullName: null }), {
      fullName: "",
      preferredLocale: "fr",
      phone: "+22222123456",
    })
  })

  it("an untouched form has no changes (no empty PATCH is sent)", () => {
    const result = buildProfileUpdate(profileFormValues(stored), stored)
    assert.deepEqual(result, { ok: true, changes: {} })
    assert.equal(result.ok && hasChanges(result.changes), false)
  })

  it("sends only the changed allowlisted fields, normalized", () => {
    const result = buildProfileUpdate(
      { fullName: "  Aminetou Mint Ahmed ", preferredLocale: "ar", phone: "33 44 55 66" },
      stored
    )
    assert.deepEqual(result, {
      ok: true,
      changes: { fullName: "Aminetou Mint Ahmed", preferredLocale: "ar", phone: "+22233445566" },
    })
  })

  it("the same phone in another format is not a change", () => {
    const result = buildProfileUpdate({ ...profileFormValues(stored), phone: "22 12 34 56" }, stored)
    assert.deepEqual(result, { ok: true, changes: {} })
  })

  it("an empty or invalid phone is refused (the phone cannot be cleared)", () => {
    for (const phone of ["", "  ", "123", "+0123456789", "abcdefgh"]) {
      assert.deepEqual(buildProfileUpdate({ ...profileFormValues(stored), phone }, stored), {
        ok: false,
        errors: { phone: "invalidPhone" },
      })
    }
  })

  it("a set name cannot be cleared; an unset name may stay empty", () => {
    assert.deepEqual(buildProfileUpdate({ ...profileFormValues(stored), fullName: "   " }, stored), {
      ok: false,
      errors: { fullName: "fullNameRequired" },
    })
    const unnamed = { ...stored, fullName: null }
    assert.deepEqual(buildProfileUpdate(profileFormValues(unnamed), unnamed), { ok: true, changes: {} })
  })

  it("applies the API name rules: NFC, 1–100 characters, no control characters", () => {
    const decomposed = "Fatimetou Mé"
    const result = buildProfileUpdate({ ...profileFormValues(stored), fullName: decomposed }, stored)
    assert.deepEqual(result, { ok: true, changes: { fullName: "Fatimetou Mé" } })
    assert.deepEqual(buildProfileUpdate({ ...profileFormValues(stored), fullName: "a".repeat(101) }, stored), {
      ok: false,
      errors: { fullName: "fullNameTooLong" },
    })
    assert.equal(buildProfileUpdate({ ...profileFormValues(stored), fullName: "a".repeat(100) }, stored).ok, true)
    assert.deepEqual(buildProfileUpdate({ ...profileFormValues(stored), fullName: "Ami\u0007netou" }, stored), {
      ok: false,
      errors: { fullName: "fullNameInvalid" },
    })
  })

  it("never puts a non-allowlisted key in the request body", () => {
    const tampered = { ...profileFormValues(stored), phone: "33445566", role: "ADMIN", phoneVerified: true }
    const result = buildProfileUpdate(tampered, stored)
    assert.equal(result.ok, true)
    if (result.ok) assert.deepEqual(Object.keys(result.changes), ["phone"])
  })

  it("every field error has a French and an Arabic message", () => {
    for (const locale of ["fr", "ar"] as const) {
      for (const key of ["fullNameRequired", "fullNameTooLong", "fullNameInvalid", "invalidPhone"] as const) {
        assert.ok(PROFILE_MESSAGES[locale].errors[key].length > 0)
      }
      // The phone stays labelled as unverified.
      assert.match(PROFILE_MESSAGES[locale].phone, locale === "fr" ? /non vérifié/ : /غير مُتحقق/)
    }
  })
})

describe("profile API responses (spec 04)", () => {
  const outcome = async (status: number, body: unknown) => interpretProfileResult(await classifyResponse(json(status, body)))

  it("200 → saved profile", async () => {
    assert.deepEqual(await outcome(200, account), { state: "ok", account })
  })

  it("400 INVALID_PHONE → phone field error; other 400 → invalid", async () => {
    assert.equal((await outcome(400, { error: { code: "INVALID_PHONE" } })).state, "invalid-phone")
    assert.equal((await outcome(400, { error: { code: "BAD_REQUEST" } })).state, "invalid")
  })

  it("401 → signed out; 403 or 404 → account setup first", async () => {
    assert.equal((await outcome(401, { error: { code: "UNAUTHORIZED" } })).state, "signed-out")
    assert.equal((await outcome(403, { error: { code: "FORBIDDEN" } })).state, "not-bootstrapped")
    assert.equal((await outcome(404, { error: { code: "PROFILE_NOT_FOUND" } })).state, "not-bootstrapped")
  })

  it("429 → rate limited; 503 (any code) → unavailable; 500 → error", async () => {
    assert.equal((await outcome(429, { error: { code: "RATE_LIMITED" } })).state, "rate-limited")
    assert.equal((await outcome(503, { error: { code: "SERVICE_UNAVAILABLE" } })).state, "unavailable")
    assert.equal((await outcome(503, { error: { code: "AUTH_UNAVAILABLE" } })).state, "unavailable")
    assert.equal((await outcome(500, { error: { code: "INTERNAL_ERROR" } })).state, "error")
  })
})
