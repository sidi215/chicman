import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { normalizePhoneNumber } from "@chicman/shared"

import { apiRequest, classifyResponse } from "../../lib/api-client"
import { authErrorKey, isEnumerationSensitive } from "./auth-errors"
import { interpretSessionCheck, shouldEndSession } from "./session-check"
import type { SupabaseClient } from "@supabase/supabase-js"

import { interpretSetupResult } from "./account-setup"
import { createAuthService } from "./auth-service"
import { CALLBACK_DESTINATIONS, parseEmailLinkFragment } from "./callback"
import { normalizeEmail, validateLogin, validatePhone, validateRegistration } from "./validation"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("API response handling (spec 03)", () => {
  it("401 ends the session", async () => {
    const check = interpretSessionCheck(await classifyResponse(json(401, { error: { code: "UNAUTHORIZED" } })))
    assert.equal(check.state, "signed-out")
    assert.equal(shouldEndSession(check), true)
  })

  it("503 AUTH_UNAVAILABLE keeps the session", async () => {
    const check = interpretSessionCheck(await classifyResponse(json(503, { error: { code: "AUTH_UNAVAILABLE" } })))
    assert.equal(check.state, "unavailable")
    assert.equal(shouldEndSession(check), false)
  })

  it("a network error keeps the session", async () => {
    const failing = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    const check = interpretSessionCheck(await apiRequest("/auth/session", "token", {}, failing))
    assert.equal(check.state, "unavailable")
    assert.equal(shouldEndSession(check), false)
  })

  it("403 means a valid session without an application account", async () => {
    const check = interpretSessionCheck(await classifyResponse(json(403, { error: { code: "FORBIDDEN" } })))
    assert.equal(check.state, "not-bootstrapped")
    assert.equal(shouldEndSession(check), false)
  })

  it("other errors (including a 503 without AUTH_UNAVAILABLE) keep the session", async () => {
    for (const response of [json(500, {}), json(503, { error: { code: "OTHER" } })]) {
      const check = interpretSessionCheck(await classifyResponse(response))
      assert.equal(check.state, "error")
      assert.equal(shouldEndSession(check), false)
    }
  })

  it("200 returns the session from the API", async () => {
    const check = interpretSessionCheck(await classifyResponse(json(200, { userId: "u1", roles: ["CUSTOMER"] })))
    assert.deepEqual(check, { state: "active", session: { userId: "u1", roles: ["CUSTOMER"] } })
  })

  it("sends the token only as a Bearer Authorization header", async () => {
    let seen: { url: string; headers: Headers } | null = null
    const capture = (async (url: string | URL | Request, init?: RequestInit) => {
      seen = { url: String(url), headers: new Headers(init?.headers) }
      return json(200, { userId: "u1", roles: [] })
    }) as typeof fetch
    await apiRequest("/auth/session", "abc.def.ghi", {}, capture)
    assert.ok(seen)
    const { url, headers } = seen as { url: string; headers: Headers }
    assert.equal(headers.get("authorization"), "Bearer abc.def.ghi")
    assert.ok(!url.includes("abc.def.ghi"))
  })
})

describe("phone normalization", () => {
  it("normalizes Mauritanian and international numbers to E.164", () => {
    assert.equal(normalizePhoneNumber("22 12 34 56"), "+22222123456")
    assert.equal(normalizePhoneNumber("+222 22-12-34-56"), "+22222123456")
    assert.equal(normalizePhoneNumber("00222 22123456"), "+22222123456")
    assert.equal(normalizePhoneNumber("+33 6 12 34 56 78"), "+33612345678")
  })

  it("rejects invalid input", () => {
    for (const value of ["", "123", "abcdefgh", "+0123456789", "+1234567890123456", "2212345"]) {
      assert.equal(normalizePhoneNumber(value), null, value)
    }
  })
})

describe("form validation", () => {
  it("validates login with email", () => {
    assert.deepEqual(validateLogin({ email: "  Aicha@Example.COM ", password: "secret" }), {
      ok: true,
      value: { email: "aicha@example.com", password: "secret" },
    })
    assert.deepEqual(validateLogin({ email: "nope", password: "" }), {
      ok: false,
      errors: { email: "invalidEmail", password: "passwordRequired" },
    })
  })

  it("sign-up takes email and password only, with confirmation", () => {
    assert.deepEqual(validateRegistration({ email: "a@b.mr", password: "a", confirmPassword: "a" }), {
      ok: true,
      value: { email: "a@b.mr", password: "a" },
    })
    assert.deepEqual(validateRegistration({ email: "a@b.mr", password: "a", confirmPassword: "b" }), {
      ok: false,
      errors: { confirmPassword: "passwordMismatch" },
    })
  })

  it("rejects implausible emails", () => {
    for (const value of ["", "a", "a@b", "a b@c.d", "@b.mr", `${"a".repeat(250)}@b.mr`]) {
      assert.equal(normalizeEmail(value), null, value)
    }
  })

  it("validates the account-setup phone", () => {
    assert.deepEqual(validatePhone("22 12 34 56"), { ok: true, value: "+22222123456" })
    assert.deepEqual(validatePhone("12"), { ok: false, errors: { phone: "invalidPhone" } })
  })
})

describe("Supabase error mapping", () => {
  it("maps known codes", () => {
    assert.equal(authErrorKey({ code: "invalid_credentials" }), "invalidCredentials")
    assert.equal(authErrorKey({ code: "email_not_confirmed" }), "emailNotConfirmed")
    assert.equal(authErrorKey({ code: "weak_password" }), "weakPassword")
    assert.equal(authErrorKey({ code: "captcha_failed" }), "captchaFailed")
    assert.equal(authErrorKey({ code: "over_email_send_rate_limit" }), "rateLimited")
    assert.equal(authErrorKey({ status: 429 }), "rateLimited")
    assert.equal(authErrorKey({ name: "AuthRetryableFetchError" }), "network")
    assert.equal(authErrorKey(new Error("x")), "generic")
  })

  it("treats 'already registered' as enumeration-sensitive", () => {
    assert.equal(isEnumerationSensitive({ code: "user_already_exists" }), true)
    assert.equal(isEnumerationSensitive({ code: "email_exists" }), true)
    assert.equal(isEnumerationSensitive({ code: "weak_password" }), false)
  })
})

describe("email link callback (spec 03)", () => {
  const hash = "a".repeat(56)

  it("accepts only token_hash with type email or recovery", () => {
    assert.deepEqual(parseEmailLinkFragment(`#token_hash=${hash}&type=email`), { kind: "token-hash", tokenHash: hash, type: "email" })
    assert.deepEqual(parseEmailLinkFragment(`#token_hash=${hash}&type=recovery`), { kind: "token-hash", tokenHash: hash, type: "recovery" })
    for (const fragment of [
      "",
      "#type=email",
      `#token_hash=${hash}`,
      `#token_hash=${hash}&type=signup`,
      `#token_hash=${hash}&type=magiclink`,
      "#token_hash=short&type=email",
      `#token_hash=${hash}<script>&type=email`,
      "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid",
    ]) {
      assert.equal(parseEmailLinkFragment(fragment), null, fragment)
    }
  })

  it("accepts Supabase default-template redirects (session in the fragment, type signup or recovery)", () => {
    const jwt = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln"
    const base = `#access_token=${jwt}&expires_at=1&expires_in=3600&refresh_token=abcdefgh12&token_type=bearer`
    assert.deepEqual(parseEmailLinkFragment(`${base}&type=signup`), {
      kind: "session",
      accessToken: jwt,
      refreshToken: "abcdefgh12",
      type: "email",
    })
    assert.equal(parseEmailLinkFragment(`${base}&type=recovery`)?.type, "recovery")
    for (const fragment of [
      `${base}&type=magiclink`,
      `${base}&type=invite`,
      `${base}`,
      `#access_token=not-a-jwt&refresh_token=abcdefgh12&type=signup`,
      `#access_token=${jwt}&type=signup`,
    ]) {
      assert.equal(parseEmailLinkFragment(fragment), null, fragment)
    }
  })

  it("ignores redirect parameters: destinations are fixed", () => {
    const link = parseEmailLinkFragment(`#token_hash=${hash}&type=email&next=https://evil.example&redirect_to=//evil.example`)
    assert.deepEqual(link, { kind: "token-hash", tokenHash: hash, type: "email" })
    assert.deepEqual(CALLBACK_DESTINATIONS, { email: "/account", recovery: "/auth/update-password" })
  })
})

describe("auth service (spec 03)", () => {
  type Call = { method: string; args: unknown[] }
  const fakeSupabase = (responses: Record<string, { error: unknown; data?: unknown }>) => {
    const calls: Call[] = []
    const handler = (method: string) => async (...args: unknown[]) => {
      calls.push({ method, args })
      const response = responses[method] ?? { error: null }
      return { data: response.data ?? {}, error: response.error }
    }
    const auth = new Proxy({}, { get: (_target, method: string) => handler(method) })
    return { client: { auth } as unknown as SupabaseClient, calls }
  }
  const callback = () => "https://chicman.test/auth/callback"

  it("sign-up sends the callback and the Turnstile token, and never the phone", async () => {
    const { client, calls } = fakeSupabase({})
    const service = createAuthService(client, callback)
    assert.deepEqual(await service.register("a@b.mr", "pw", "captcha-token"), { ok: true })
    assert.deepEqual(calls[0], {
      method: "signUp",
      args: [{ email: "a@b.mr", password: "pw", options: { emailRedirectTo: callback(), captchaToken: "captcha-token" } }],
    })
    assert.ok(!JSON.stringify(calls).includes("phone"))
  })

  it("sign-up reports success for an already registered email (no enumeration)", async () => {
    const { client } = fakeSupabase({ signUp: { error: { code: "user_already_exists" } } })
    assert.deepEqual(await createAuthService(client, callback).register("a@b.mr", "pw"), { ok: true })
  })

  it("login and recovery pass the Turnstile token; recovery hides unknown addresses", async () => {
    const { client, calls } = fakeSupabase({ resetPasswordForEmail: { error: { code: "user_not_found" } } })
    const service = createAuthService(client, callback)
    await service.signIn("a@b.mr", "pw", "t1")
    assert.deepEqual(calls[0]?.args, [{ email: "a@b.mr", password: "pw", options: { captchaToken: "t1" } }])
    assert.deepEqual(await service.requestPasswordReset("a@b.mr", "t2"), { ok: true })
    assert.deepEqual(calls[1]?.args, ["a@b.mr", { redirectTo: callback(), captchaToken: "t2" }])
  })

  it("omits captchaToken when Turnstile is disabled", async () => {
    const { client, calls } = fakeSupabase({})
    await createAuthService(client, callback).signIn("a@b.mr", "pw")
    assert.deepEqual(calls[0]?.args, [{ email: "a@b.mr", password: "pw", options: {} }])
  })

  it("verifies email links by token hash", async () => {
    const { client, calls } = fakeSupabase({ verifyOtp: { error: null, data: { session: { access_token: "x" } } } })
    const link = { kind: "token-hash", tokenHash: "h".repeat(56), type: "email" } as const
    assert.deepEqual(await createAuthService(client, callback).verifyEmailLink(link), { ok: true })
    assert.deepEqual(calls[0]?.args, [{ token_hash: "h".repeat(56), type: "email" }])
  })

  it("hands default-provider session tokens to Supabase to check (setSession)", async () => {
    const { client, calls } = fakeSupabase({ setSession: { error: null, data: { session: { access_token: "x" } } } })
    const link = { kind: "session", accessToken: "a.b.c", refreshToken: "r".repeat(12), type: "email" } as const
    assert.deepEqual(await createAuthService(client, callback).verifyEmailLink(link), { ok: true })
    assert.deepEqual(calls[0], { method: "setSession", args: [{ access_token: "a.b.c", refresh_token: "r".repeat(12) }] })
  })
})

describe("anti-enumeration: registered and unregistered addresses look the same (spec 03)", () => {
  type Supa = Parameters<typeof createAuthService>[0]
  const service = (responses: Record<string, { error: unknown; data?: unknown }>) => {
    const auth = new Proxy(
      {},
      { get: (_t, method: string) => async () => ({ data: responses[method]?.data ?? {}, error: responses[method]?.error ?? null }) }
    )
    return createAuthService({ auth } as unknown as Supa, () => "http://localhost:3000/auth/callback")
  }

  it("login: unknown email and wrong password give the same result", async () => {
    // Supabase returns invalid_credentials for both (verified live for the unknown email).
    const unknown = await service({ signInWithPassword: { error: { code: "invalid_credentials", status: 400 } } }).signIn("u@x.mr", "pw")
    const wrong = await service({ signInWithPassword: { error: { code: "invalid_credentials", status: 400 } } }).signIn("r@x.mr", "pw")
    assert.deepEqual(unknown, { ok: false, error: "invalidCredentials" })
    assert.deepEqual(wrong, unknown)
  })

  it("recovery: every outcome Supabase can return for an address is the same generic success", async () => {
    const registered = await service({ resetPasswordForEmail: { error: null } }).requestPasswordReset("r@x.mr")
    const unregistered = await service({ resetPasswordForEmail: { error: null } }).requestPasswordReset("u@x.mr")
    const notFound = await service({ resetPasswordForEmail: { error: { code: "user_not_found", status: 404 } } }).requestPasswordReset("u@x.mr")
    for (const result of [registered, unregistered, notFound]) assert.deepEqual(result, { ok: true })
  })

  it("sign-up: a new and an already registered address both lead to 'check your email'", async () => {
    const fresh = await service({ signUp: { error: null, data: { user: { identities: [{}] } } } }).register("u@x.mr", "pw")
    // Supabase (confirmations on) answers an existing address with an obfuscated user, or user_already_exists.
    const existingObfuscated = await service({ signUp: { error: null, data: { user: { identities: [] } } } }).register("r@x.mr", "pw")
    const existingError = await service({ signUp: { error: { code: "user_already_exists", status: 422 } } }).register("r@x.mr", "pw")
    for (const result of [fresh, existingObfuscated, existingError]) assert.deepEqual(result, { ok: true })
  })
})

describe("account setup response handling (spec 04)", () => {
  it("maps bootstrap responses", async () => {
    const account = { userId: "u", roles: ["CUSTOMER"], profile: {} }
    assert.equal(interpretSetupResult(await classifyResponse(json(201, account))).state, "done")
    assert.equal(interpretSetupResult(await classifyResponse(json(200, account))).state, "done")
    assert.equal(interpretSetupResult(await classifyResponse(json(400, { error: { code: "INVALID_PHONE" } }))).state, "invalid-phone")
    assert.equal(
      interpretSetupResult(await classifyResponse(json(403, { error: { code: "EMAIL_NOT_CONFIRMED" } }))).state,
      "email-not-confirmed"
    )
    assert.equal(interpretSetupResult(await classifyResponse(json(401, {}))).state, "signed-out")
    assert.equal(interpretSetupResult(await classifyResponse(json(503, { error: { code: "AUTH_UNAVAILABLE" } }))).state, "unavailable")
    assert.equal(interpretSetupResult(await classifyResponse(json(503, { error: { code: "SERVICE_UNAVAILABLE" } }))).state, "unavailable")
    assert.equal(interpretSetupResult(await classifyResponse(json(429, { error: { code: "RATE_LIMITED" } }))).state, "rate-limited")
  })
})
