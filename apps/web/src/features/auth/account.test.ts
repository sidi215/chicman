import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { AccountProfile } from "@chicman/shared"

import { classifyResponse } from "../../lib/api-client"
import { buildProfileUpdate, profileFormValues } from "../profile/profile-form"
import {
  ACCOUNT_HOME,
  ACCOUNT_SETUP_HREF,
  accountFromSessionCheck,
  afterSetupHref,
  areaDecision,
  interpretSetupResult,
  isBuyer,
  recordRegistrationIntent,
  type AccountArea,
  type AccountState,
} from "./account"
import { ACCOUNT_MESSAGES } from "./account-messages"

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
const active = (accountType: "BUYER" | "SELLER" | "ADMIN"): AccountState => ({ state: "active", userId: "u", accountType })

describe("account state from the session check (AT-1)", () => {
  it("maps each session check", () => {
    assert.deepEqual(accountFromSessionCheck({ state: "active", session: { userId: "u", accountType: "SELLER" } }), active("SELLER"))
    assert.deepEqual(accountFromSessionCheck({ state: "not-bootstrapped" }), { state: "needs-setup" })
    assert.deepEqual(accountFromSessionCheck({ state: "signed-out" }), { state: "guest" })
    assert.deepEqual(accountFromSessionCheck({ state: "unavailable" }), { state: "unavailable" })
    assert.deepEqual(accountFromSessionCheck({ state: "error" }), { state: "error" })
  })

  it("lets only a Buyer use buyer actions (Q6)", () => {
    assert.equal(isBuyer(active("BUYER")), true)
    for (const state of [active("SELLER"), active("ADMIN"), { state: "guest" } as const, { state: "needs-setup" } as const]) assert.equal(isBuyer(state), false)
  })
})

describe("area gates (AT-1, section 12)", () => {
  it("admits each type only to its own area, plus the profile, and sends the others home", () => {
    const expected: Record<"BUYER" | "SELLER" | "ADMIN", Record<Exclude<AccountArea, "setup">, string>> = {
      BUYER: { buyer: "render", seller: "/account", admin: "/account", profile: "render" },
      SELLER: { buyer: "/seller", seller: "render", admin: "/seller", profile: "render" },
      ADMIN: { buyer: "/admin/shops", seller: "/admin/shops", admin: "render", profile: "render" },
    }
    for (const [type, areas] of Object.entries(expected) as [keyof typeof expected, Record<string, string>][]) {
      for (const [area, outcome] of Object.entries(areas)) {
        const decision = areaDecision(area as AccountArea, active(type))
        assert.equal(decision.kind === "redirect" ? decision.to : decision.kind, outcome, `${type} on ${area}`)
      }
    }
  })

  it("sends guests to the login page, identities without an account to setup, and set-up accounts away from setup", () => {
    for (const area of ["buyer", "seller", "admin", "profile", "setup"] as const) {
      assert.deepEqual(areaDecision(area, { state: "guest" }), { kind: "redirect", to: "/login" })
      assert.equal(areaDecision(area, { state: "loading" }).kind, "loading")
      assert.deepEqual(areaDecision(area, { state: "unavailable" }), { kind: "failed", reason: "unavailable" })
    }
    assert.deepEqual(areaDecision("buyer", { state: "needs-setup" }), { kind: "redirect", to: ACCOUNT_SETUP_HREF })
    assert.deepEqual(areaDecision("setup", { state: "needs-setup" }), { kind: "render" })
    for (const type of ["BUYER", "SELLER", "ADMIN"] as const) assert.deepEqual(areaDecision("setup", active(type)), { kind: "redirect", to: ACCOUNT_HOME[type] })
  })

  it("starts a new buyer on the address step and a new seller on the dashboard", () => {
    assert.equal(afterSetupHref("BUYER"), "/account/addresses/new?onboarding=1")
    assert.equal(afterSetupHref("SELLER"), "/seller")
  })
})

describe("account setup responses (AT-1)", () => {
  it("maps every outcome", async () => {
    const map = async (status: number, body: unknown) => interpretSetupResult(await classifyResponse(json(status, body))).state
    assert.equal(await map(201, { userId: "u", accountType: "SELLER", profile: {} }), "done")
    assert.equal(await map(400, { error: { code: "INVALID_PHONE" } }), "invalid-phone")
    assert.equal(await map(400, { error: { code: "BAD_REQUEST" } }), "invalid")
    assert.equal(await map(409, { error: { code: "REGISTRATION_INTENT_REQUIRED" } }), "intent-required")
    assert.equal(await map(409, { error: { code: "ACCOUNT_TYPE_CONFLICT" } }), "type-conflict")
    assert.equal(await map(409, { error: { code: "SHOP_ALREADY_EXISTS" } }), "shop-exists")
    assert.equal(await map(403, { error: { code: "EMAIL_NOT_CONFIRMED" } }), "email-not-confirmed")
    assert.equal(await map(429, { error: { code: "RATE_LIMITED" } }), "rate-limited")
  })
})

describe("registration intent (section 5.3)", () => {
  it("posts the identity and the chosen type without a token, and reads the answer", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fake = (status: number, body?: unknown): typeof fetch =>
      (async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init })
        return body === undefined ? new Response(null, { status }) : json(status, body)
      }) as typeof fetch
    assert.equal(await recordRegistrationIntent("id-1", "SELLER", fake(204)), "recorded")
    assert.match(calls[0]?.url ?? "", /\/api\/v1\/registration-intents$/)
    assert.equal(calls[0]?.init?.method, "POST")
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { supabaseUserId: "id-1", accountType: "SELLER" })
    assert.equal(new Headers(calls[0]?.init?.headers).has("authorization"), false)
    assert.equal(await recordRegistrationIntent("id-1", "BUYER", fake(409, { error: { code: "REGISTRATION_INTENT_CONFLICT" } })), "conflict")
    assert.equal(await recordRegistrationIntent("id-1", "BUYER", fake(429, { error: { code: "RATE_LIMITED" } })), "failed")
    const offline = (async () => {
      throw new TypeError("network")
    }) as typeof fetch
    assert.equal(await recordRegistrationIntent("id-1", "BUYER", offline), "failed")
  })
})

describe("account messages", () => {
  it("have the same keys in French and Arabic, none empty", () => {
    assert.deepEqual(Object.keys(ACCOUNT_MESSAGES.ar).sort(), Object.keys(ACCOUNT_MESSAGES.fr).sort())
    for (const locale of ["fr", "ar"] as const) for (const value of Object.values(ACCOUNT_MESSAGES[locale])) assert.ok(value.length > 0)
  })
})

describe("profile phone for every account type (Q3)", () => {
  const admin: AccountProfile = { id: "p", fullName: null, preferredLocale: "fr", phone: null, createdAt: "", updatedAt: "" }

  it("lets an administrator without a phone save other fields, or add a phone", () => {
    const values = profileFormValues(admin)
    assert.equal(values.phone, "")
    assert.deepEqual(buildProfileUpdate({ ...values, fullName: "Admin" }, admin), { ok: true, changes: { fullName: "Admin" } })
    assert.deepEqual(buildProfileUpdate({ ...values, phone: "36 00 00 00" }, admin), { ok: true, changes: { phone: "+22236000000" } })
    assert.equal(buildProfileUpdate({ ...values, phone: "12" }, admin).ok, false)
  })

  it("never lets a stored phone be cleared", () => {
    const buyer: AccountProfile = { ...admin, phone: "+22236000000" }
    assert.deepEqual(buildProfileUpdate({ ...profileFormValues(buyer), phone: "" }, buyer), { ok: false, errors: { phone: "invalidPhone" } })
  })
})
