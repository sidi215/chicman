import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import dotenv from "dotenv";

import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { MemoryRateLimiter } from "../src/lib/rate-limiter.js";
import { PrismaCustomerRepository, type RepositoryFaults } from "../src/modules/customers/index.js";
import { PrismaShopAccessRepository } from "../src/modules/shops/shop-access.repository.js";
import { PrismaUserRepository } from "../src/modules/users/user.repository.js";
import { phoneChangeRetentionCutoff, purgeExpiredPhoneChanges } from "../src/workers/phone-change-retention.js";
import { createTestKeyStore, createTestVerifier, startApp, type RunningApp } from "./helpers/app.js";
import { FakeEmailConfirmation } from "./helpers/customers.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./helpers/keys.js";
import { resetDatabase } from "./helpers/database.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("customer bootstrap, profile, and phone history (spec 04, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const jwks = new TestJwksServer();
  const faults: RepositoryFaults = {};
  const emailConfirmation = new FakeEmailConfirmation();
  let prisma: PrismaClient;
  let app: RunningApp;
  let key: TestKey;

  before(async () => {
    prisma = createPrismaClient(databaseUrl ?? "");
    key = await createTestKey("ES256");
    await jwks.start();
    jwks.keys = [key.publicJwk];
    app = await startApp({
      corsOrigins: [],
      auth: {
        verifier: createTestVerifier(createTestKeyStore(jwks.url)),
        users: new PrismaUserRepository(prisma),
        shops: new PrismaShopAccessRepository(prisma),
      },
      customers: {
        customers: new PrismaCustomerRepository(prisma, faults),
        emailConfirmation,
        // Generous limits here; rate limiting has its own tests.
        rateLimiter: { hit: async () => ({ allowed: true, retryAfterSeconds: 1 }) },
      },
    });
  });

  after(async () => {
    await app.close();
    await jwks.stop();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    delete faults.afterUserCreated;
    delete faults.afterPhoneUpdated;
    emailConfirmation.mode = "ok";
    emailConfirmation.unconfirmed.clear();
    await resetDatabase(prisma);
  });

  const call = async (method: string, path: string, sub: string, body?: unknown) => {
    const token = await signToken(key, { sub });
    const response = await fetch(`${app.baseUrl}/api/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : null };
  };
  const bootstrap = (sub: string, body: unknown = { phone: "22 33 44 55" }) => call("POST", "/customers/me", sub, body);
  const counts = async () => ({
    users: await prisma.user.count(),
    profiles: await prisma.customerProfile.count(),
    history: await prisma.customerPhoneChange.count(),
  });

  describe("bootstrap", () => {
    it("pre-bootstrap: a valid token gets 403 on protected routes other than bootstrap", async () => {
      const sub = randomUUID();
      assert.equal((await call("GET", "/customers/me", sub)).status, 403);
      assert.equal((await call("PATCH", "/customers/me", sub, { fullName: "A" })).status, 403);
      assert.equal((await call("GET", "/auth/session", sub)).status, 403);
      assert.deepEqual(await counts(), { users: 0, profiles: 0, history: 0 });
    });

    it("first bootstrap creates one User with CUSTOMER, one profile, and an ACCOUNT_SETUP entry → 201", async () => {
      const sub = randomUUID();
      const response = await bootstrap(sub);
      assert.equal(response.status, 201);
      const profile = response.body?.["profile"] as Record<string, unknown>;
      assert.equal(profile["phone"], "+22222334455");
      assert.deepEqual(response.body?.["roles"], ["CUSTOMER"]);
      assert.ok(!("phoneVerified" in profile) && !("verified" in profile));
      assert.deepEqual(await counts(), { users: 1, profiles: 1, history: 1 });
      const entry = await prisma.customerPhoneChange.findFirstOrThrow();
      assert.equal(entry.changeType, "ACCOUNT_SETUP");
      assert.equal(entry.previousPhone, null);
      assert.equal(entry.newPhone, "+22222334455");
      assert.equal(entry.actorUserId, response.body?.["userId"]);
      assert.equal(emailConfirmation.calls.at(-1)?.supabaseUserId, sub);
      // The session check now succeeds.
      assert.equal((await call("GET", "/auth/session", sub)).status, 200);
    });

    it("repeated bootstrap reuses both records → 200, keeps the stored phone, writes no new rows", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      const again = await bootstrap(sub, { phone: "+33612345678" });
      assert.equal(again.status, 200);
      assert.equal((again.body?.["profile"] as Record<string, unknown>)["phone"], "+22222334455");
      assert.deepEqual(await counts(), { users: 1, profiles: 1, history: 1 });
    });

    it("refuses an unconfirmed email → 403 EMAIL_NOT_CONFIRMED, nothing written", async () => {
      const sub = randomUUID();
      emailConfirmation.unconfirmed.add(sub);
      const response = await bootstrap(sub);
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: { code: "EMAIL_NOT_CONFIRMED" } });
      assert.deepEqual(await counts(), { users: 0, profiles: 0, history: 0 });
    });

    it("Supabase Auth unreachable → 503 AUTH_UNAVAILABLE, nothing written", async () => {
      emailConfirmation.mode = "unavailable";
      const response = await bootstrap(randomUUID());
      assert.equal(response.status, 503);
      assert.deepEqual(response.body, { error: { code: "AUTH_UNAVAILABLE" } });
      assert.deepEqual(await counts(), { users: 0, profiles: 0, history: 0 });
    });

    it("ignores client-supplied confirmation status and identity: only the server-side check counts", async () => {
      const sub = randomUUID();
      emailConfirmation.unconfirmed.add(sub);
      const response = await bootstrap(sub, { phone: "22334455", emailConfirmed: true });
      assert.equal(response.status, 400); // unknown field is rejected outright
      const plain = await bootstrap(sub);
      assert.equal(plain.status, 403);
      assert.deepEqual(await counts(), { users: 0, profiles: 0, history: 0 });
    });

    it("missing or invalid phone, or any other body field → 400, nothing written", async () => {
      const sub = randomUUID();
      const cases: [unknown, string][] = [
        [{}, "BAD_REQUEST"],
        [{ phone: "12" }, "INVALID_PHONE"],
        [{ phone: "not a phone" }, "INVALID_PHONE"],
        [{ phone: 22334455 }, "BAD_REQUEST"],
        [{ phone: "22334455", role: "ADMIN" }, "BAD_REQUEST"],
        [{ phone: "22334455", userId: randomUUID() }, "BAD_REQUEST"],
        [{ phone: "22334455", phoneVerified: true }, "BAD_REQUEST"],
      ];
      for (const [body, code] of cases) {
        const response = await bootstrap(sub, body);
        assert.equal(response.status, 400, JSON.stringify(body));
        assert.deepEqual(response.body, { error: { code } }, JSON.stringify(body));
      }
      assert.deepEqual(await counts(), { users: 0, profiles: 0, history: 0 });
    });

    it("repairs an existing User without a profile, keeping its roles", async () => {
      const sub = randomUUID();
      const user = await prisma.user.create({
        data: { supabaseUserId: sub, roles: { create: [{ role: "CUSTOMER" }, { role: "SELLER" }] } },
      });
      const response = await bootstrap(sub);
      assert.equal(response.status, 201);
      assert.equal(response.body?.["userId"], user.id);
      assert.deepEqual(response.body?.["roles"], ["CUSTOMER", "SELLER"]);
      assert.deepEqual(await counts(), { users: 1, profiles: 1, history: 1 });
    });

    it("concurrent bootstrap requests produce exactly one User and one profile", async () => {
      const sub = randomUUID();
      const responses = await Promise.all(Array.from({ length: 8 }, () => bootstrap(sub)));
      assert.ok(responses.every((r) => r.status === 201 || r.status === 200), JSON.stringify(responses.map((r) => r.status)));
      assert.equal(responses.filter((r) => r.status === 201).length, 1);
      assert.deepEqual(await counts(), { users: 1, profiles: 1, history: 1 });
    });

    it("an injected failure after the User insert rolls back everything, and a retry succeeds", async () => {
      const sub = randomUUID();
      faults.afterUserCreated = () => {
        throw new Error("injected");
      };
      assert.equal((await bootstrap(sub)).status, 500);
      assert.deepEqual(await counts(), { users: 0, profiles: 0, history: 0 });
      delete faults.afterUserCreated;
      assert.equal((await bootstrap(sub)).status, 201);
      assert.deepEqual(await counts(), { users: 1, profiles: 1, history: 1 });
    });

    it("the database rejects duplicate supabaseUserId and CustomerProfile.userId", async () => {
      const sub = randomUUID();
      const user = await prisma.user.create({ data: { supabaseUserId: sub } });
      await assert.rejects(prisma.user.create({ data: { supabaseUserId: sub } }), { code: "P2002" });
      await prisma.customerProfile.create({ data: { userId: user.id, phone: "+22222334455" } });
      await assert.rejects(prisma.customerProfile.create({ data: { userId: user.id, phone: "+22222334456" } }), { code: "P2002" });
    });

    it("the database rejects a non-E.164 phone", async () => {
      const user = await prisma.user.create({ data: { supabaseUserId: randomUUID() } });
      await assert.rejects(prisma.customerProfile.create({ data: { userId: user.id, phone: "22334455" } }));
    });
  });

  describe("profile read and update", () => {
    it("returns the user's own profile", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      const response = await call("GET", "/customers/me", sub);
      assert.equal(response.status, 200);
      const profile = response.body?.["profile"] as Record<string, unknown>;
      assert.deepEqual(Object.keys(profile).sort(), ["createdAt", "fullName", "id", "phone", "preferredLocale", "updatedAt"]);
      assert.equal(profile["preferredLocale"], "fr");
    });

    it("updates fullName, preferredLocale, and phone", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      const response = await call("PATCH", "/customers/me", sub, {
        fullName: "  Aïcha Mint Ahmed  ",
        preferredLocale: "ar",
        phone: "+222 36 11 22 33",
      });
      assert.equal(response.status, 200);
      const profile = response.body?.["profile"] as Record<string, unknown>;
      assert.equal(profile["fullName"], "Aïcha Mint Ahmed");
      assert.equal(profile["preferredLocale"], "ar");
      assert.equal(profile["phone"], "+22236112233");
      const stored = await prisma.customerProfile.findFirstOrThrow();
      assert.equal(stored.phone, "+22236112233");
    });

    it("rejects protected or unknown fields, alone or mixed → 400, nothing written", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      const before = await prisma.customerProfile.findFirstOrThrow();
      for (const field of ["supabaseUserId", "userId", "id", "email", "phoneVerified", "role", "roles", "shopId", "createdAt", "updatedAt"]) {
        for (const body of [{ [field]: "x" }, { fullName: "Changed", [field]: "x" }]) {
          const response = await call("PATCH", "/customers/me", sub, body);
          assert.equal(response.status, 400, JSON.stringify(body));
        }
      }
      const afterRow = await prisma.customerProfile.findFirstOrThrow();
      assert.deepEqual(afterRow, before);
      assert.equal(await prisma.customerPhoneChange.count(), 1);
    });

    it("rejects invalid values → 400", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      for (const body of [{}, { fullName: "   " }, { fullName: "a".repeat(101) }, { fullName: "bad\u0007" }, { preferredLocale: "en" }, { phone: "" }, { phone: null }, { phone: "123" }]) {
        assert.equal((await call("PATCH", "/customers/me", sub, body)).status, 400, JSON.stringify(body));
      }
    });

    it("cannot read or modify another user's profile: the target always comes from the token", async () => {
      const alice = randomUUID();
      const bob = randomUUID();
      await bootstrap(alice);
      await bootstrap(bob, { phone: "36000000" });
      const response = await call("PATCH", "/customers/me", bob, { fullName: "Bob" });
      assert.equal(response.status, 200);
      const aliceProfile = await call("GET", "/customers/me", alice);
      assert.equal((aliceProfile.body?.["profile"] as Record<string, unknown>)["fullName"], null);
    });
  });

  describe("phone change history", () => {
    it("a phone change writes one CUSTOMER_UPDATE entry with previous, new, actor, and time", async () => {
      const sub = randomUUID();
      const setup = await bootstrap(sub);
      const started = Date.now();
      await call("PATCH", "/customers/me", sub, { phone: "36112233" });
      const entries = await prisma.customerPhoneChange.findMany({ orderBy: { createdAt: "asc" } });
      assert.equal(entries.length, 2);
      const update = entries[1];
      assert.equal(update?.changeType, "CUSTOMER_UPDATE");
      assert.equal(update?.previousPhone, "+22222334455");
      assert.equal(update?.newPhone, "+22236112233");
      assert.equal(update?.actorUserId, setup.body?.["userId"]);
      assert.ok((update?.createdAt.getTime() ?? 0) >= started - 1000);
    });

    it("the same normalized phone writes nothing", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      const before = await prisma.customerProfile.findFirstOrThrow();
      assert.equal((await call("PATCH", "/customers/me", sub, { phone: "+222 22 33 44 55" })).status, 200);
      assert.equal(await prisma.customerPhoneChange.count(), 1);
      assert.deepEqual(await prisma.customerProfile.findFirstOrThrow(), before);
    });

    it("an injected failure after the phone update leaves neither the new phone nor a history entry", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      faults.afterPhoneUpdated = () => {
        throw new Error("injected");
      };
      assert.equal((await call("PATCH", "/customers/me", sub, { phone: "36112233" })).status, 500);
      assert.equal((await prisma.customerProfile.findFirstOrThrow()).phone, "+22222334455");
      assert.equal(await prisma.customerPhoneChange.count(), 1);
    });

    it("concurrent phone changes form a consistent previousPhone chain", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      const phones = ["36000001", "36000002", "36000003", "36000004", "36000005", "36000006"];
      await Promise.all(phones.map((phone) => call("PATCH", "/customers/me", sub, { phone })));
      const entries = await prisma.customerPhoneChange.findMany({ orderBy: { createdAt: "asc" } });
      assert.equal(entries.length, 1 + phones.length);
      // Each entry's previous value is the previous entry's new value.
      for (let i = 1; i < entries.length; i += 1) {
        assert.equal(entries[i]?.previousPhone, entries[i - 1]?.newPhone);
      }
      assert.equal((await prisma.customerProfile.findFirstOrThrow()).phone, entries.at(-1)?.newPhone);
    });

    it("no API response exposes the history", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      await call("PATCH", "/customers/me", sub, { phone: "36112233" });
      for (const response of [await call("GET", "/customers/me", sub), await call("GET", "/auth/session", sub)]) {
        const text = JSON.stringify(response.body);
        assert.ok(!text.includes("+22222334455"), "previous phone must not be exposed");
        assert.ok(!/history|phoneChanges|previousPhone/i.test(text));
      }
    });

    it("retention deletes entries older than 12 months, keeps newer ones and the profile phone, and is idempotent", async () => {
      const sub = randomUUID();
      await bootstrap(sub);
      await call("PATCH", "/customers/me", sub, { phone: "36112233" });
      const now = new Date("2027-06-15T12:00:00Z");
      const cutoff = phoneChangeRetentionCutoff(now);
      assert.equal(cutoff.toISOString(), "2026-06-15T12:00:00.000Z");
      const [oldest, newest] = await prisma.customerPhoneChange.findMany({ orderBy: { createdAt: "asc" } });
      assert.ok(oldest && newest);
      await prisma.customerPhoneChange.update({ where: { id: oldest.id }, data: { createdAt: new Date(cutoff.getTime() - 1) } });
      await prisma.customerPhoneChange.update({ where: { id: newest.id }, data: { createdAt: cutoff } });

      assert.equal(await purgeExpiredPhoneChanges(prisma, { now, batchSize: 1 }), 1);
      assert.equal(await purgeExpiredPhoneChanges(prisma, { now }), 0);
      const remaining = await prisma.customerPhoneChange.findMany();
      assert.deepEqual(remaining.map((entry) => entry.id), [newest.id]);
      assert.equal((await prisma.customerProfile.findFirstOrThrow()).phone, "+22236112233");
    });
  });
});
