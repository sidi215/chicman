import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server, type Socket, connect } from "node:net";
import type { AddressInfo } from "node:net";
import { after, before, beforeEach, describe, it } from "node:test";

import dotenv from "dotenv";
import { Redis } from "ioredis";

import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { FallbackRateLimiter, RedisRateLimiter, type RateLimiter } from "../src/lib/rate-limiter.js";
import {
  BOOTSTRAP_RATE_LIMIT,
  PROFILE_UPDATE_RATE_LIMIT,
  PrismaCustomerRepository,
} from "../src/modules/customers/index.js";
import { PrismaShopAccessRepository } from "../src/modules/shops/shop-access.repository.js";
import { PrismaUserRepository } from "../src/modules/users/user.repository.js";
import { createTestKeyStore, createTestVerifier, startApp, type RunningApp } from "./helpers/app.js";
import { FakeEmailConfirmation } from "./helpers/customers.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./helpers/keys.js";
import { resetDatabase } from "./helpers/database.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];
const redisUrl = process.env["REDIS_URL"];
const skip =
  databaseUrl === undefined || redisUrl === undefined ? "TEST_DATABASE_URL and REDIS_URL are required" : false;

/** A TCP proxy in front of Redis, to simulate an outage and a recovery. */
class RedisProxy {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  port = 0;

  constructor(private readonly target: { host: string; port: number }) {}

  async start(): Promise<void> {
    this.server = createServer((client) => {
      const upstream = connect(this.target.port, this.target.host);
      for (const socket of [client, upstream]) {
        this.sockets.add(socket);
        socket.on("close", () => this.sockets.delete(socket));
        socket.on("error", () => socket.destroy());
      }
      client.pipe(upstream).pipe(client);
    });
    await new Promise<void>((resolve) => this.server?.listen(this.port, "127.0.0.1", resolve));
    this.port = (this.server.address() as AddressInfo).port;
  }

  /** Outage: close every connection and stop accepting new ones. */
  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
    this.server = null;
  }
}

describe("API rate limits against Redis and PostgreSQL (spec 03/04)", { skip }, () => {
  const jwks = new TestJwksServer();
  const prefix = `chicman:rl-test:${randomUUID()}:`;
  let prisma: PrismaClient;
  let redis: Redis;
  let key: TestKey;
  const apps: RunningApp[] = [];
  const extraClients: Redis[] = [];
  const newClient = () => {
    const client = new Redis(redisUrl ?? "", { maxRetriesPerRequest: 1 });
    extraClients.push(client);
    return client;
  };

  before(async () => {
    prisma = createPrismaClient(databaseUrl ?? "");
    redis = new Redis(redisUrl ?? "", { maxRetriesPerRequest: 1 });
    key = await createTestKey("ES256");
    await jwks.start();
    jwks.keys = [key.publicJwk];
  });

  after(async () => {
    for (const app of apps) await app.close();
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    redis.disconnect();
    for (const client of extraClients) client.disconnect();
    await jwks.stop();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function startWith(rateLimiter: RateLimiter): Promise<RunningApp> {
    const app = await startApp({
      corsOrigins: [],
      auth: {
        verifier: createTestVerifier(createTestKeyStore(jwks.url)),
        users: new PrismaUserRepository(prisma),
        shops: new PrismaShopAccessRepository(prisma),
      },
      customers: {
        customers: new PrismaCustomerRepository(prisma),
        emailConfirmation: new FakeEmailConfirmation(),
        rateLimiter,
      },
    });
    apps.push(app);
    return app;
  }

  /** A namespace per test, so counters never leak between tests. */
  const redisLimiter = (namespace: string, client: Redis = redis) =>
    new RedisRateLimiter(client, `${prefix}${namespace}:`);

  async function call(app: RunningApp, method: string, sub: string, body: unknown) {
    const response = await fetch(`${app.baseUrl}/api/v1/customers/me`, {
      method,
      headers: { authorization: `Bearer ${await signToken(key, { sub })}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: response.status, retryAfter: response.headers.get("retry-after"), text: await response.text() };
  }
  const bootstrap = (app: RunningApp, sub: string) => call(app, "POST", sub, { phone: "22334455" });
  const patch = (app: RunningApp, sub: string, n: number) =>
    call(app, "PATCH", sub, { fullName: `Name ${n}` });

  function assertGeneric429(response: { status: number; retryAfter: string | null; text: string }, windowSeconds: number) {
    assert.equal(response.status, 429);
    // Only the stable code: no limit, count, key, IP, user ID, or stack.
    assert.equal(response.text, '{"error":{"code":"RATE_LIMITED"}}');
    const retryAfter = Number(response.retryAfter);
    assert.ok(retryAfter >= 1 && retryAfter <= windowSeconds, `Retry-After ${response.retryAfter}`);
  }

  it("account setup: 10 per user per 10 minutes, then 429; the window resets", async () => {
    assert.deepEqual(
      [BOOTSTRAP_RATE_LIMIT.perUser, BOOTSTRAP_RATE_LIMIT.perIp, BOOTSTRAP_RATE_LIMIT.windowMs],
      [10, 60, 600_000],
    );
    const app = await startWith(redisLimiter("bootstrap-user"));
    const sub = randomUUID();
    for (let i = 1; i <= 10; i += 1) {
      const response = await bootstrap(app, sub);
      assert.ok(response.status === 201 || response.status === 200, `request ${i}: ${response.status}`);
    }
    assertGeneric429(await bootstrap(app, sub), 600);

    // The counter lives in Redis with the 10-minute window.
    const userKey = `${prefix}bootstrap-user:bootstrap:user:${sub}`;
    assert.equal(await redis.get(userKey), "11");
    const ttl = await redis.pttl(userKey);
    assert.ok(ttl > 590_000 && ttl <= 600_000, `TTL ${ttl}`);

    // Reset: when the window expires, requests are allowed again.
    await redis.pexpire(userKey, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal((await bootstrap(app, sub)).status, 200);
  });

  it("account setup: 60 per IP per 10 minutes across users, then 429", async () => {
    const app = await startWith(redisLimiter("bootstrap-ip"));
    for (let i = 1; i <= 60; i += 1) {
      const response = await bootstrap(app, randomUUID());
      assert.equal(response.status, 201, `request ${i}`);
    }
    assertGeneric429(await bootstrap(app, randomUUID()), 600);
    assert.equal(await prisma.user.count(), 60, "the refused request wrote nothing");
  });

  it("profile updates: 20 per user per 10 minutes, then 429", async () => {
    assert.deepEqual(
      [PROFILE_UPDATE_RATE_LIMIT.perUser, PROFILE_UPDATE_RATE_LIMIT.perIp, PROFILE_UPDATE_RATE_LIMIT.windowMs],
      [20, 100, 600_000],
    );
    const app = await startWith(redisLimiter("profile-user"));
    const sub = randomUUID();
    await bootstrap(app, sub);
    for (let i = 1; i <= 20; i += 1) assert.equal((await patch(app, sub, i)).status, 200, `request ${i}`);
    assertGeneric429(await patch(app, sub, 21), 600);
    const profile = await prisma.customerProfile.findFirstOrThrow();
    assert.equal(profile.fullName, "Name 20", "the refused update was not applied");
  });

  it("profile updates: 100 per IP per 10 minutes across users, then 429", async () => {
    const app = await startWith(redisLimiter("profile-ip"));
    const users = Array.from({ length: 6 }, () => randomUUID());
    for (const sub of users) await bootstrap(app, sub);
    let sent = 0;
    for (const sub of users.slice(0, 5)) {
      for (let i = 0; i < 20; i += 1) {
        sent += 1;
        assert.equal((await patch(app, sub, sent)).status, 200, `request ${sent}`);
      }
    }
    assertGeneric429(await patch(app, users[5] ?? "", 101), 600);
  });

  it("is distributed: two API instances share the Redis counters", async () => {
    const namespace = "distributed";
    const first = await startWith(redisLimiter(namespace));
    const second = await startWith(redisLimiter(namespace, newClient()));
    const sub = randomUUID();
    for (let i = 0; i < 5; i += 1) assert.notEqual((await bootstrap(first, sub)).status, 429);
    for (let i = 0; i < 5; i += 1) assert.notEqual((await bootstrap(second, sub)).status, 429);
    // The 11th request overall is refused, whichever instance receives it.
    assertGeneric429(await bootstrap(first, sub), 600);
    assertGeneric429(await bootstrap(second, sub), 600);
  });

  it("Redis outage: limits stay enforced in memory; recovery returns to Redis", async () => {
    const target = new URL(redisUrl ?? "");
    const proxy = new RedisProxy({ host: target.hostname, port: Number(target.port || 6379) });
    await proxy.start();
    const proxied = new Redis(proxy.port, "127.0.0.1", {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => 50,
    });
    proxied.on("error", () => {
      // Expected during the outage.
    });
    await new Promise((resolve) => proxied.once("ready", resolve));
    const warnings: string[] = [];
    const limiter = new FallbackRateLimiter(
      redisLimiter("outage", proxied),
      undefined,
      Date.now,
      (message) => warnings.push(message),
    );
    const app = await startWith(limiter);

    // Outage.
    await proxy.stop();
    const sub = randomUUID();
    for (let i = 1; i <= 10; i += 1) {
      const response = await bootstrap(app, sub);
      assert.ok(response.status === 201 || response.status === 200, `request ${i} during outage: ${response.status}`);
    }
    assertGeneric429(await bootstrap(app, sub), 600);
    assert.equal(warnings.length, 1, "the fallback is reported once per minute");
    assert.equal(await redis.exists(`${prefix}outage:bootstrap:user:${sub}`), 0, "outage counts were not in Redis");

    // Recovery: the client reconnects and counting returns to Redis.
    await proxy.start();
    for (let i = 0; i < 100 && proxied.status !== "ready"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(proxied.status, "ready");
    const after = randomUUID();
    assert.equal((await bootstrap(app, after)).status, 201);
    assert.equal(await redis.get(`${prefix}outage:bootstrap:user:${after}`), "1");
    proxied.disconnect();
    await proxy.stop();
  });
});
