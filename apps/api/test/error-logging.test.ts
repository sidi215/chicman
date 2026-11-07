import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import dotenv from "dotenv";
import { Router } from "express";
import { Redis } from "ioredis";

import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { FallbackRateLimiter, RedisRateLimiter } from "../src/lib/rate-limiter.js";
import { SupabaseEmailConfirmationChecker } from "../src/modules/auth/index.js";
import { PrismaCustomerRepository } from "../src/modules/customers/index.js";
import { PrismaShopAccessRepository } from "../src/modules/shops/shop-access.repository.js";
import { PrismaUserRepository } from "../src/modules/users/user.repository.js";
import {
  FakeShopRepository,
  FakeUserRepository,
  createTestKeyStore,
  createTestVerifier,
  startApp,
  type RunningApp,
} from "./helpers/app.js";
import { FakeEmailConfirmation } from "./helpers/customers.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./helpers/keys.js";

dotenv.config({ quiet: true });
const testDatabaseUrl = process.env["TEST_DATABASE_URL"];

/** Values that must never reach a log line. */
const SECRET = {
  password: "Hunter2-NeverLog!",
  dbPassword: "DbPw-NeverLog-9f3",
  redisPassword: "RedisPw-NeverLog-7c1",
  captcha: "0x4AAAAAAA-captcha-secret-never-log",
  email: "private.person@example.org",
  phone: "+22236998877",
};

/** Captures console.error / console.warn / console.log while a test runs. */
class LogCapture {
  lines: string[] = [];
  private originals: Partial<Record<"error" | "warn" | "log", (...args: unknown[]) => void>> = {};

  start(): void {
    this.lines = [];
    for (const level of ["error", "warn", "log"] as const) {
      this.originals[level] = console[level];
      console[level] = (...args: unknown[]) => {
        this.lines.push(args.map((arg) => (arg instanceof Error ? `${arg.stack}` : String(arg))).join(" "));
      };
    }
  }

  stop(): void {
    for (const [level, original] of Object.entries(this.originals)) {
      if (original) (console as unknown as Record<string, unknown>)[level] = original;
    }
  }

  get text(): string {
    return this.lines.join("\n");
  }

  assertClean(extra: string[] = []): void {
    for (const value of [...Object.values(SECRET), ...extra]) {
      assert.ok(!this.text.includes(value), `log contains a sensitive value: ${value.slice(0, 6)}…`);
    }
    assert.ok(!/eyJ[A-Za-z0-9_-]{10,}\./.test(this.text), "log contains a JWT");
    assert.ok(!/bearer\s+\S{10,}/i.test(this.text), "log contains an Authorization header");
    assert.ok(!/(postgres(ql)?|redis):\/\//i.test(this.text), "log contains a connection URL");
  }
}

describe("error logging (spec 03, Abuse Protection and Sessions)", () => {
  const jwks = new TestJwksServer();
  const logs = new LogCapture();
  let key: TestKey;
  const apps: RunningApp[] = [];

  before(async () => {
    key = await createTestKey("ES256");
    await jwks.start();
    jwks.keys = [key.publicJwk];
  });
  after(async () => {
    for (const app of apps) await app.close();
    await jwks.stop();
  });
  beforeEach(() => logs.start());

  const verifier = () => createTestVerifier(createTestKeyStore(jwks.url));

  it("an unexpected exception: generic 500 for the client, type and stack for developers, no secrets", async () => {
    const app = await startApp({
      corsOrigins: [],
      auth: { verifier: verifier(), users: new FakeUserRepository(), shops: new FakeShopRepository() },
      routers: () => {
        const router = Router();
        router.post("/fixtures/explode", (req) => {
          const body = req.body as { password?: string };
          throw Object.assign(new Error(`boom: password=${body.password} email=${SECRET.email}`), { code: "E_FIXTURE" });
        });
        return [router];
      },
    });
    apps.push(app);
    const token = await signToken(key);
    const response = await fetch(`${app.baseUrl}/api/v1/fixtures/explode`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ password: SECRET.password, phone: SECRET.phone }),
    });
    logs.stop();

    assert.equal(response.status, 500);
    assert.equal(await response.text(), '{"error":{"code":"INTERNAL_ERROR"}}');
    // Useful for developers: the error type, its code, and where it was thrown.
    assert.match(logs.text, /Unhandled Error \(E_FIXTURE\)/);
    assert.match(logs.text, /at .*error-logging\.test\.ts/);
    logs.assertClean([token]);
  });

  it("a database connection failure: 503 SERVICE_UNAVAILABLE, the Prisma code logged, no database URL or password", async () => {
    const prisma: PrismaClient = createPrismaClient(
      `postgresql://chicman:${SECRET.dbPassword}@127.0.0.1:1/chicman`,
    );
    const app = await startApp({
      corsOrigins: [],
      auth: { verifier: verifier(), users: new PrismaUserRepository(prisma), shops: new PrismaShopAccessRepository(prisma) },
      customers: {
        customers: new PrismaCustomerRepository(prisma),
        emailConfirmation: new FakeEmailConfirmation(),
        rateLimiter: { hit: async () => ({ allowed: true, retryAfterSeconds: 1 }) },
      },
    });
    apps.push(app);
    const token = await signToken(key, { sub: randomUUID() });
    const response = await fetch(`${app.baseUrl}/api/v1/customers/me`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ phone: SECRET.phone }),
    });
    logs.stop();
    await prisma.$disconnect().catch(() => undefined);

    assert.equal(response.status, 503);
    assert.equal(await response.text(), '{"error":{"code":"SERVICE_UNAVAILABLE"}}');
    assert.match(logs.text, /^Database unavailable \(P1001 DatabaseNotReachable\)$/m, "the outage is logged, not swallowed");
    logs.assertClean([token]);
  });

  /** A real database query from a fixture route, against `url`. */
  async function queryThrough(url: string, query: (prisma: PrismaClient) => Promise<unknown>) {
    const prisma = createPrismaClient(url);
    const app = await startApp({
      corsOrigins: [],
      auth: { verifier: verifier(), users: new FakeUserRepository(), shops: new FakeShopRepository() },
      routers: () => {
        const router = Router();
        router.get("/fixtures/query", async (_req, res) => {
          await query(prisma);
          res.status(204).end();
        });
        return [router];
      },
    });
    apps.push(app);
    const response = await fetch(`${app.baseUrl}/api/v1/fixtures/query`);
    await prisma.$disconnect().catch(() => undefined);
    return { status: response.status, text: await response.text() };
  }

  it("unrelated database errors stay 500 INTERNAL_ERROR (division by zero, wrong credentials, missing database)", { skip: testDatabaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, async () => {
    const valid = new URL(testDatabaseUrl ?? "");
    const wrongPassword = new URL(valid);
    wrongPassword.password = SECRET.dbPassword;
    const missingDatabase = new URL(valid);
    missingDatabase.pathname = "/chicman_does_not_exist";

    const results = [
      await queryThrough(valid.toString(), (prisma) => prisma.$executeRawUnsafe("select 1/0")),
      await queryThrough(wrongPassword.toString(), (prisma) => prisma.user.findFirst()),
      await queryThrough(missingDatabase.toString(), (prisma) => prisma.user.findFirst()),
    ];
    logs.stop();
    for (const result of results) {
      assert.equal(result.status, 500);
      assert.equal(result.text, '{"error":{"code":"INTERNAL_ERROR"}}');
    }
    assert.match(logs.text, /Unhandled PrismaClientKnownRequestError \(P2010\)/);
    assert.match(logs.text, /Unhandled PrismaClientKnownRequestError \(P1000\)/);
    assert.match(logs.text, /Unhandled PrismaClientKnownRequestError \(P1003\)/);
    assert.ok(!logs.text.includes("Database unavailable"));
    // The local test password is "chicman", which also appears in every stack-frame path,
    // so the planted wrong password (SECRET.dbPassword) and the URL checks carry this test.
    logs.assertClean();
  });

  it("a Redis connection failure: limits fall back to memory, one warning, no Redis URL or password", async () => {
    const broken = new Redis(`redis://:${SECRET.redisPassword}@127.0.0.1:1`, {
      maxRetriesPerRequest: 0,
      enableOfflineQueue: false,
      retryStrategy: () => null,
      lazyConnect: true,
    });
    broken.on("error", () => {
      // The server attaches the same no-op listener; failures surface through the limiter.
    });
    const limiter = new FallbackRateLimiter(new RedisRateLimiter(broken, "chicman:rl-test-broken:"));
    const app = await startApp({
      corsOrigins: [],
      auth: { verifier: verifier(), users: new FakeUserRepository(), shops: new FakeShopRepository() },
      customers: {
        customers: { bootstrap: async () => { throw new Error("not used"); }, findByUserId: async () => null, update: async () => null },
        emailConfirmation: new FakeEmailConfirmation(),
        rateLimiter: limiter,
      },
    });
    apps.push(app);
    const token = await signToken(key);
    const response = await fetch(`${app.baseUrl}/api/v1/customers/me`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ fullName: "x" }),
    });
    logs.stop();
    broken.disconnect();

    // The request is still limited (memory) and reaches the handler: 404 PROFILE_NOT_FOUND.
    assert.equal(response.status, 404);
    assert.match(logs.text, /Rate limiter: Redis unavailable; enforcing limits with in-process counters\./);
    logs.assertClean([token]);
  });

  it("Supabase Auth unreachable during the email check: 503 for the client, the reason logged, no token", async () => {
    const checker = new SupabaseEmailConfirmationChecker({
      supabaseUrl: "http://127.0.0.1:1",
      publishableKey: "sb_publishable_test",
      timeoutMs: 500,
    });
    const token = await signToken(key);
    await assert.rejects(checker.isEmailConfirmed(token, randomUUID()), { kind: "unavailable" });
    logs.stop();
    assert.match(logs.text, /Email-confirmation check unavailable: network error/);
    logs.assertClean([token, "sb_publishable_test"]);
  });

  it("a JWKS refresh failure is logged with the reason only", async () => {
    const down = new TestJwksServer();
    await down.start();
    down.mode = "http-error";
    const store = createTestKeyStore(down.url);
    assert.deepEqual(await store.getKey("some-kid"), { status: "unavailable" });
    await down.stop();
    logs.stop();
    assert.match(logs.text, /JWKS refresh failed \(1 in a row\): http status 500$/);
    logs.assertClean();
  });
});
