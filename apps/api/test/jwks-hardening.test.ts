import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { AuthenticationError } from "../src/modules/auth/index.js";
import {
  FakeShopRepository,
  FakeUserRepository,
  createTestKeyStore,
  createTestVerifier,
  startApp,
  type KeyStoreTestOptions,
} from "./helpers/app.js";
import { TestClock } from "./helpers/clock.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./helpers/keys.js";

const COOLDOWN_MS = 30_000;

async function verifyResult(
  verifier: ReturnType<typeof createTestVerifier>,
  token: string,
): Promise<"accepted" | "invalid" | "unavailable"> {
  try {
    await verifier.verify(token);
    return "accepted";
  } catch (error) {
    assert.ok(error instanceof AuthenticationError);
    return error.kind;
  }
}

describe("JWKS retrieval hardening (spec 03)", () => {
  let jwks: TestJwksServer;
  let key: TestKey;
  let clock: TestClock;

  beforeEach(async () => {
    jwks = new TestJwksServer();
    await jwks.start();
    key = await createTestKey("ES256");
    jwks.keys = [key.publicJwk];
    clock = new TestClock();
  });

  afterEach(async () => {
    await jwks.stop();
  });

  const setup = (options: KeyStoreTestOptions = {}) => {
    const keyStore = createTestKeyStore(jwks.url, { cooldownMs: COOLDOWN_MS, now: clock.now, ...options });
    return createTestVerifier(keyStore);
  };

  it("verifies a token with a cached kid without a JWKS request", async () => {
    const verifier = setup();
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 1);

    for (let i = 0; i < 20; i += 1) {
      assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    }
    clock.advance(599_000); // still within SUPABASE_JWKS_MAX_AGE_MS
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 1);
  });

  it("rejects many random unknown kids within the cooldown with at most one JWKS request", async () => {
    const verifier = setup();
    const results = [];
    for (let i = 0; i < 200; i += 1) {
      results.push(await verifyResult(verifier, await signToken(key, { kid: randomUUID() })));
    }
    assert.ok(results.every((result) => result === "invalid"));
    assert.ok(jwks.requestCount <= 1, `expected ≤ 1 JWKS request, got ${jwks.requestCount}`);
  });

  it("issues exactly one JWKS request for 100 concurrent verifications needing a refresh", async () => {
    jwks.latencyMs = 100;
    const verifier = setup();
    const tokens = await Promise.all(Array.from({ length: 100 }, () => signToken(key)));
    const results = await Promise.all(tokens.map((token) => verifyResult(verifier, token)));
    assert.ok(results.every((result) => result === "accepted"));
    assert.equal(jwks.requestCount, 1);
  });

  it("shares one JWKS request across 50 concurrent verifications with distinct unknown kids, then serves them from the negative cache", async () => {
    jwks.latencyMs = 100;
    const verifier = setup();
    const tokens = await Promise.all(Array.from({ length: 50 }, () => signToken(key, { kid: randomUUID() })));
    const results = await Promise.all(tokens.map((token) => verifyResult(verifier, token)));
    assert.ok(results.every((result) => result === "invalid"), "unknown kids are 401, never 503");
    assert.equal(jwks.requestCount, 1);
    // Repeating the same attacker-chosen kids within the cooldown costs no request.
    const repeated = await Promise.all(tokens.map((token) => verifyResult(verifier, token)));
    assert.ok(repeated.every((result) => result === "invalid"));
    assert.equal(jwks.requestCount, 1);
  });

  it("logs a failed refresh without the error message (only a fixed reason)", async () => {
    await jwks.stop();
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      assert.equal(await verifyResult(setup(), await signToken(key)), "unavailable");
    } finally {
      console.warn = original;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /^JWKS refresh failed \(1 in a row\): (network error|timeout|http status \d+|invalid response)$/);
    assert.doesNotMatch(warnings[0]!, /127\.0\.0\.1|localhost|ECONNREFUSED|fetch failed/);
  });

  it("fails closed with 503 AUTH_UNAVAILABLE within the timeout bound when the JWKS server is slow", async () => {
    jwks.latencyMs = 2_000;
    const verifier = setup({ timeoutMs: 200 });
    const app = await startApp({
      corsOrigins: [],
      auth: { verifier, users: new FakeUserRepository(), shops: new FakeShopRepository() },
    });
    try {
      const started = performance.now();
      const response = await fetch(`${app.baseUrl}/api/v1/auth/session`, {
        headers: { authorization: `Bearer ${await signToken(key)}` },
      });
      const elapsed = performance.now() - started;
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), { error: { code: "AUTH_UNAVAILABLE" } });
      assert.ok(elapsed < 1_000, `expected to fail within the timeout bound, took ${elapsed.toFixed(0)} ms`);
    } finally {
      await app.close();
    }
  });

  it("returns 503 (not 401) for an uncached kid when the JWKS connection is refused", async () => {
    await jwks.stop();
    const verifier = setup();
    assert.equal(await verifyResult(verifier, await signToken(key)), "unavailable");
  });

  it("returns 503 for an uncached kid when the JWKS endpoint drops the connection or errors", async () => {
    jwks.mode = "drop";
    assert.equal(await verifyResult(setup(), await signToken(key)), "unavailable");
    jwks.mode = "http-error";
    assert.equal(await verifyResult(setup(), await signToken(key)), "unavailable");
  });

  it("returns 503 while a failed refresh is backing off, without new requests", async () => {
    await jwks.stop();
    const verifier = setup();
    assert.equal(await verifyResult(verifier, await signToken(key)), "unavailable");
    const otherKey = await createTestKey("ES256");
    assert.equal(await verifyResult(verifier, await signToken(otherKey)), "unavailable");
  });

  it("returns 401 (not 503) for an unknown kid after a successful refresh", async () => {
    const verifier = setup();
    const unknown = await createTestKey("ES256");
    assert.equal(await verifyResult(verifier, await signToken(unknown)), "invalid");
    assert.equal(jwks.requestCount, 1);
    // Negative-cache / cooldown hit, even with the endpoint down.
    await jwks.stop();
    assert.equal(await verifyResult(verifier, await signToken(unknown)), "invalid");
  });

  it("returns 401 for invalid tokens with a cached key while the JWKS endpoint is down", async () => {
    const verifier = setup();
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    await jwks.stop();
    assert.equal(await verifyResult(verifier, await signToken(key, { expIn: -120 })), "invalid");
    assert.equal(await verifyResult(verifier, await signToken(key, { aud: "anon" })), "invalid");
    const forged = await createTestKey("ES256", key.kid);
    assert.equal(await verifyResult(verifier, await signToken(forged)), "invalid");
    // A valid token with the cached kid still verifies.
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
  });

  it("keeps known kids verifying after a failed refresh, and backs off the retry interval", async () => {
    const verifier = setup({ maxAgeMs: 60_000 });
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 1);

    jwks.mode = "http-error";
    clock.advance(61_000); // key set expired → refresh needed

    // Failure 1: stale-on-error keeps the known kid working.
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 2);

    // Within the first interval (cooldown): no new request.
    clock.advance(COOLDOWN_MS - 1);
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 2);

    // After the cooldown: failure 2, then the interval doubles to 60 s.
    clock.advance(1);
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 3);

    clock.advance(COOLDOWN_MS);
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 3, "backed-off interval (60 s) has not elapsed");

    clock.advance(COOLDOWN_MS);
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    assert.equal(jwks.requestCount, 4, "failure 3 after 60 s; next interval is 120 s");

    clock.advance(119_000);
    await verifyResult(verifier, await signToken(key));
    assert.equal(jwks.requestCount, 4);

    // Recovery resets the interval to the cooldown.
    jwks.mode = "ok";
    clock.advance(1_000);
    await verifyResult(verifier, await signToken(key));
    assert.equal(jwks.requestCount, 5);
    clock.advance(61_000);
    await verifyResult(verifier, await signToken(key));
    assert.equal(jwks.requestCount, 6);
  });

  it("retries at most every 5 minutes after many failures", async () => {
    jwks.mode = "http-error";
    const verifier = setup();
    await verifyResult(verifier, await signToken(key));
    let expected = 1;
    let interval = COOLDOWN_MS;
    for (let i = 0; i < 6; i += 1) {
      interval = Math.min(interval * (i === 0 ? 1 : 2), 5 * 60_000);
      clock.advance(interval);
      await verifyResult(verifier, await signToken(key));
      expected += 1;
      assert.equal(jwks.requestCount, expected);
    }
    // Interval is now capped: 5 minutes later there is exactly one more request.
    clock.advance(5 * 60_000 - 1);
    await verifyResult(verifier, await signToken(key));
    assert.equal(jwks.requestCount, expected);
    clock.advance(1);
    await verifyResult(verifier, await signToken(key));
    assert.equal(jwks.requestCount, expected + 1);
  });

  it("verifies a newly published key after one refresh, and stops verifying a removed key after the next refresh", async () => {
    const verifier = setup();
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");

    // Rotation: a standby key is published, then used for signing.
    const next = await createTestKey("ES256");
    jwks.keys = [key.publicJwk, next.publicJwk];
    clock.advance(COOLDOWN_MS);
    assert.equal(await verifyResult(verifier, await signToken(next)), "accepted");
    assert.equal(jwks.requestCount, 2);

    // The old key is removed from the JWKS. It keeps verifying until the
    // next refresh (cached), then stops.
    jwks.keys = [next.publicJwk];
    assert.equal(await verifyResult(verifier, await signToken(key)), "accepted");
    clock.advance(COOLDOWN_MS);
    const unknownTrigger = await createTestKey("ES256");
    assert.equal(await verifyResult(verifier, await signToken(unknownTrigger)), "invalid"); // triggers refresh
    assert.equal(jwks.requestCount, 3);
    assert.equal(await verifyResult(verifier, await signToken(key)), "invalid");
    assert.equal(await verifyResult(verifier, await signToken(next)), "accepted");
  });

  it("bounds the negative cache at 1000 entries", async () => {
    const keyStore = createTestKeyStore(jwks.url, { cooldownMs: COOLDOWN_MS, now: clock.now });
    await keyStore.getKey(key.kid);
    for (let i = 0; i < 5_000; i += 1) await keyStore.getKey(randomUUID());
    const size = (keyStore as unknown as { negativeCache: Map<string, number> }).negativeCache.size;
    assert.ok(size <= 1000, `negative cache holds ${size} entries`);
    assert.equal(jwks.requestCount, 1);
  });
});
