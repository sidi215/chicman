import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { buildContentSecurityPolicy, LOCAL_OBJECT_STORAGE_ORIGIN, type CspEnv } from "./csp"

const base: CspEnv = {
  NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
  NEXT_PUBLIC_API_URL: "http://localhost:4000",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
}

/** Directive name → its sources. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name = "", ...sources] = part.trim().split(/\s+/)
      return [name, sources]
    })
  )
}

const MAP = "https://tiles.openfreemap.org"

const policy = (env: CspEnv, turnstile = true) => directives(buildContentSecurityPolicy(env, { turnstile }))

describe("content security policy", () => {
  it("development allows the local SeaweedFS origin for uploads and logos when storage is not configured", () => {
    const csp = policy({ ...base, NODE_ENV: "development" })
    assert.deepEqual(csp.get("connect-src"), ["'self'", "https://ref.supabase.co", "http://localhost:4000", LOCAL_OBJECT_STORAGE_ORIGIN, MAP, "ws:"])
    assert.deepEqual(csp.get("img-src"), ["'self'", "data:", "blob:", LOCAL_OBJECT_STORAGE_ORIGIN])
  })

  it("development uses the configured storage origins instead of the local default", () => {
    const csp = policy({
      ...base,
      NODE_ENV: "development",
      NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN: "http://127.0.0.1:9000",
      NEXT_PUBLIC_MEDIA_BASE_URL: "http://127.0.0.1:9000/chicman-media",
    })
    assert.ok(csp.get("connect-src")?.includes("http://127.0.0.1:9000"))
    assert.ok(!csp.get("connect-src")?.includes(LOCAL_OBJECT_STORAGE_ORIGIN))
    assert.deepEqual(csp.get("img-src"), ["'self'", "data:", "blob:", "http://127.0.0.1:9000"])
  })

  it("production never inherits the local SeaweedFS origin", () => {
    const csp = policy({ ...base, NODE_ENV: "production" })
    const text = buildContentSecurityPolicy({ ...base, NODE_ENV: "production" }, { turnstile: true })
    assert.ok(!text.includes("localhost:8333"))
    assert.deepEqual(csp.get("connect-src"), ["'self'", "https://ref.supabase.co", "http://localhost:4000", MAP])
    assert.deepEqual(csp.get("img-src"), ["'self'", "data:", "blob:"])
    assert.ok(!csp.get("script-src")?.includes("'unsafe-eval'"))
  })

  it("production allows exactly the configured storage endpoint and media origin (origins only)", () => {
    const csp = policy({
      ...base,
      NODE_ENV: "production",
      NEXT_PUBLIC_SITE_URL: "https://chicman.mr",
      NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN: "https://acct.r2.cloudflarestorage.com/chicman-uploads",
      NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.chicman.mr/logos",
    })
    assert.deepEqual(csp.get("connect-src"), [
      "'self'",
      "https://ref.supabase.co",
      "http://localhost:4000",
      "https://acct.r2.cloudflarestorage.com",
      MAP,
    ])
    assert.deepEqual(csp.get("img-src"), ["'self'", "data:", "blob:", "https://media.chicman.mr"])
    assert.ok(csp.has("upgrade-insecure-requests"))
  })

  it("ignores invalid or non-http(s) storage values and never emits wildcards", () => {
    for (const NODE_ENV of ["development", "production"]) {
      const text = buildContentSecurityPolicy(
        { ...base, NODE_ENV, NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN: "*", NEXT_PUBLIC_MEDIA_BASE_URL: "javascript:alert(1)" },
        { turnstile: true }
      )
      assert.ok(!/(^|\s)\*(\s|;|$)/.test(text), text)
      assert.ok(!text.includes("javascript:"))
    }
  })

  it("allows the map provider (OpenFreeMap by default, configurable) and MapLibre's blob worker", () => {
    for (const NODE_ENV of ["development", "production"]) {
      const csp = policy({ ...base, NODE_ENV })
      assert.ok(csp.get("connect-src")?.includes(MAP))
      assert.deepEqual(csp.get("worker-src"), ["'self'", "blob:"])
      assert.ok(!csp.get("script-src")?.includes("blob:"))
    }
    const custom = policy({ ...base, NODE_ENV: "production", NEXT_PUBLIC_MAP_STYLE_URL: "https://maps.example.mr/style.json" })
    assert.ok(custom.get("connect-src")?.includes("https://maps.example.mr"))
    assert.ok(!custom.get("connect-src")?.includes(MAP))
    const invalid = policy({ ...base, NODE_ENV: "production", NEXT_PUBLIC_MAP_STYLE_URL: "*" })
    assert.ok(invalid.get("connect-src")?.includes(MAP))
  })

  it("keeps every other directive locked down", () => {
    for (const NODE_ENV of ["development", "production"]) {
      const csp = policy({ ...base, NODE_ENV })
      assert.deepEqual(csp.get("default-src"), ["'self'"])
      assert.deepEqual(csp.get("object-src"), ["'none'"])
      assert.deepEqual(csp.get("frame-ancestors"), ["'none'"])
      assert.deepEqual(csp.get("base-uri"), ["'none'"])
      assert.deepEqual(csp.get("form-action"), ["'self'"])
    }
    // The auth callback policy still has no Turnstile.
    assert.deepEqual(policy({ ...base, NODE_ENV: "production" }, false).get("frame-src"), ["'none'"])
  })
})
