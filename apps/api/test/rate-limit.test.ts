import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { Router } from "express";

import { FallbackRateLimiter, MemoryRateLimiter, type RateLimiter } from "../src/lib/rate-limiter.js";
import { rateLimit } from "../src/middleware/rate-limit.js";
import { FakeShopRepository, FakeUserRepository, createTestKeyStore, createTestVerifier, startApp, type RunningApp } from "./helpers/app.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./helpers/keys.js";

describe("API rate limiting (spec 03, Abuse Protection)", () => {
  const jwks = new TestJwksServer();
  let app: RunningApp;
  let key: TestKey;
  const broken: RateLimiter = {
    hit: async () => {
      throw new Error("redis down");
    },
  };

  before(async () => {
    key = await createTestKey("ES256");
    await jwks.start();
    jwks.keys = [key.publicJwk];
    const limiter = new MemoryRateLimiter();
    app = await startApp({
      corsOrigins: [],
      auth: { verifier: createTestVerifier(createTestKeyStore(jwks.url)), users: new FakeUserRepository(), shops: new FakeShopRepository() },
      routers: (guards) => {
        const router = Router();
        router.post("/limited", ...guards.tokenOnly, rateLimit(limiter, { name: "t", perUser: 2, perIp: 5, windowMs: 60_000 }), (_req, res) => {
          res.status(204).end();
        });
        router.post("/broken", ...guards.tokenOnly, rateLimit(broken, { name: "b", perUser: 1, perIp: 1, windowMs: 60_000 }), (_req, res) => {
          res.status(204).end();
        });
        return [router];
      },
    });
  });
  after(async () => {
    await app.close();
    await jwks.stop();
  });

  const post = async (path: string, sub: string) =>
    fetch(`${app.baseUrl}/api/v1${path}`, { method: "POST", headers: { authorization: `Bearer ${await signToken(key, { sub })}` } });

  it("limits per user, then per IP, with 429 RATE_LIMITED and Retry-After", async () => {
    const alice = randomUUID();
    assert.equal((await post("/limited", alice)).status, 204);
    assert.equal((await post("/limited", alice)).status, 204);
    const limited = await post("/limited", alice);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: { code: "RATE_LIMITED" } });
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    // Other users share the IP limit (5 per window, 3 used so far).
    assert.equal((await post("/limited", randomUUID())).status, 204);
    assert.equal((await post("/limited", randomUUID())).status, 204);
    assert.equal((await post("/limited", randomUUID())).status, 429);
  });

  it("fails closed (503) if the limiter itself throws", async () => {
    const response = await post("/broken", randomUUID());
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "SERVICE_UNAVAILABLE" } });
  });

  it("keeps enforcing limits with in-process counters when Redis fails, and warns", async () => {
    const warnings: string[] = [];
    const limiter = new FallbackRateLimiter(broken, new MemoryRateLimiter(), Date.now, (m) => warnings.push(m));
    const key = "bootstrap:user:7d0c1f9e-user-id";
    assert.equal((await limiter.hit(key, 2, 60_000)).allowed, true);
    assert.equal((await limiter.hit(key, 2, 60_000)).allowed, true);
    assert.equal((await limiter.hit(key, 2, 60_000)).allowed, false);
    assert.equal(warnings.length, 1, "warned once");
    assert.ok(!warnings[0]?.includes("7d0c1f9e"), "no request data in the warning");
  });

  it("memory counters reset after the window", async () => {
    let now = 0;
    const limiter = new MemoryRateLimiter(() => now);
    assert.equal((await limiter.hit("k", 1, 1000)).allowed, true);
    assert.equal((await limiter.hit("k", 1, 1000)).allowed, false);
    now = 1000;
    assert.equal((await limiter.hit("k", 1, 1000)).allowed, true);
  });
});

describe("error logging", () => {
  it("logs the error type and code, never the message", async () => {
    const { describeError } = await import("../src/middleware/error-handler.js");
    const err = Object.assign(new Error('violates check constraint, row contains "+22222334455"'), { code: "P2010" });
    const text = describeError(err);
    assert.ok(text.startsWith("Unhandled Error (P2010)"));
    assert.ok(!text.includes("+22222334455"));
  });
});
