import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { Role, ShopStatus } from "@chicman/shared";
import dotenv from "dotenv";
import { Router } from "express";

import { notFound } from "../src/lib/http-error.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import type { AuthGuards } from "../src/modules/auth/index.js";
import { PrismaShopAccessRepository } from "../src/modules/shops/shop-access.repository.js";
import { PrismaUserRepository } from "../src/modules/users/user.repository.js";
import { createTestKeyStore, createTestVerifier, startApp, type RunningApp } from "./helpers/app.js";
import { TestJwksServer } from "./helpers/jwks-server.js";
import { createTestKey, signToken, type TestKey } from "./helpers/keys.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

/**
 * Fixture routes that stand in for feature routes not built yet. They use the
 * production guards exactly as feature modules will.
 */
function fixtureRouter(guards: AuthGuards): Router {
  const router = Router();
  // Stand-in for the account bootstrap endpoint (spec 04): token only.
  router.post("/fixtures/bootstrap", ...guards.tokenOnly, (req, res) => {
    res.status(200).json({ hasUser: req.appUser !== null });
  });
  // A customer-private route.
  router.get("/fixtures/customer/private", ...guards.user, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  // A normal seller operation (for example product management).
  router.all("/fixtures/seller/products", ...guards.approvedSeller, (req, res) => {
    res.status(200).json({ shopId: req.sellerShop?.id });
  });
  // A seller resource addressed by shop: resolved within the user's own shop.
  router.get("/fixtures/seller/shops/:shopId/products", ...guards.approvedSeller, (req, res) => {
    const shop = req.sellerShop;
    if (shop === undefined || req.params["shopId"] !== shop.id) throw notFound();
    res.status(200).json({ shopId: shop.id });
  });
  // Administrator shop decisions (spec 06).
  for (const action of ["approve", "reject", "suspend", "reinstate"]) {
    router.post(`/fixtures/admin/shops/:shopId/${action}`, ...guards.role("ADMIN"), (_req, res) => {
      res.status(204).end();
    });
  }
  return router;
}

describe("role and seller authorization (spec 03, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const jwks = new TestJwksServer();
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
      routers: (guards) => [fixtureRouter(guards)],
    });
  });

  after(async () => {
    await app.close();
    await jwks.stop();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.customerPhoneChange.deleteMany();
    await prisma.customerProfile.deleteMany();
    await prisma.shop.deleteMany();
    await prisma.userRole.deleteMany();
    await prisma.user.deleteMany();
  });

  interface Actor {
    sub: string;
    userId: string;
    token: string;
  }

  async function createActor(roles: Role[], shopStatus?: ShopStatus, extraClaims = {}): Promise<Actor & { shopId?: string }> {
    const sub = randomUUID();
    const user = await prisma.user.create({
      data: { supabaseUserId: sub, roles: { create: roles.map((role) => ({ role })) } },
    });
    const shop =
      shopStatus === undefined
        ? undefined
        : await prisma.shop.create({ data: { ownerUserId: user.id, status: shopStatus } });
    const token = await signToken(key, { sub, extraClaims });
    return { sub, userId: user.id, token, ...(shop ? { shopId: shop.id } : {}) };
  }

  const call = (path: string, token: string | null, init: RequestInit = {}) =>
    fetch(`${app.baseUrl}/api/v1${path}`, {
      ...init,
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        "content-type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
      },
    });

  describe("pre-bootstrap token (no application user)", () => {
    it("can call only the bootstrap route; other protected routes → 403", async () => {
      const token = await signToken(key, { sub: randomUUID() });
      const bootstrap = await call("/fixtures/bootstrap", token, { method: "POST" });
      assert.equal(bootstrap.status, 200);
      assert.deepEqual(await bootstrap.json(), { hasUser: false });
      assert.equal((await call("/auth/session", token)).status, 403);
      assert.equal((await call("/fixtures/customer/private", token)).status, 403);
      assert.equal((await call("/fixtures/seller/products", token)).status, 403);
      assert.equal((await call("/fixtures/admin/shops/x/approve", token, { method: "POST" })).status, 403);
    });
  });

  describe("roles come from PostgreSQL", () => {
    it("returns the database roles for the verified sub", async () => {
      const actor = await createActor(["CUSTOMER", "SELLER"], "APPROVED");
      const response = await call("/auth/session", actor.token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { userId: actor.userId, roles: ["CUSTOMER", "SELLER"] });
    });

    it("a CUSTOMER claiming ADMIN/SELLER in token claims, headers, query, or body is still a CUSTOMER", async () => {
      const actor = await createActor(["CUSTOMER"], undefined, {
        role: "ADMIN",
        roles: ["ADMIN", "SELLER"],
        app_metadata: { role: "ADMIN", roles: ["ADMIN"] },
        user_metadata: { role: "SELLER" },
        user_role: "ADMIN",
      });
      const spoof = {
        headers: { "x-role": "ADMIN", "x-user-role": "SELLER", "x-user-id": randomUUID(), "x-shop-id": randomUUID() },
        body: JSON.stringify({ role: "ADMIN", roles: ["ADMIN", "SELLER"], userId: randomUUID(), status: "APPROVED" }),
      };
      const query = "?role=ADMIN&roles=SELLER&userId=x";

      const session = await call(`/auth/session${query}`, actor.token, { headers: spoof.headers });
      assert.deepEqual(await session.json(), { userId: actor.userId, roles: ["CUSTOMER"] });

      for (const action of ["approve", "reject", "suspend", "reinstate"]) {
        const response = await call(`/fixtures/admin/shops/${randomUUID()}/${action}${query}`, actor.token, {
          method: "POST",
          ...spoof,
        });
        assert.equal(response.status, 403, action);
      }
      const seller = await call(`/fixtures/seller/products${query}`, actor.token, { method: "POST", ...spoof });
      assert.equal(seller.status, 403);
    });

    it("an ADMIN can call administrator routes", async () => {
      const admin = await createActor(["CUSTOMER", "ADMIN"]);
      const response = await call(`/fixtures/admin/shops/${randomUUID()}/approve`, admin.token, { method: "POST" });
      assert.equal(response.status, 204);
    });

    it("a role change in PostgreSQL takes effect on the next request with the same token", async () => {
      const actor = await createActor(["CUSTOMER"]);
      assert.equal((await call(`/fixtures/admin/shops/x/approve`, actor.token, { method: "POST" })).status, 403);
      await prisma.userRole.create({ data: { userId: actor.userId, role: "ADMIN" } });
      assert.equal((await call(`/fixtures/admin/shops/x/approve`, actor.token, { method: "POST" })).status, 204);
    });
  });

  describe("normal seller operations (requireApprovedSeller)", () => {
    it("SELLER with an APPROVED shop they own → allowed", async () => {
      const seller = await createActor(["CUSTOMER", "SELLER"], "APPROVED");
      const response = await call("/fixtures/seller/products", seller.token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { shopId: seller.shopId });
    });

    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      it(`SELLER with a ${status} shop → 403`, async () => {
        const seller = await createActor(["CUSTOMER", "SELLER"], status);
        assert.equal((await call("/fixtures/seller/products", seller.token)).status, 403);
        assert.equal((await call(`/fixtures/seller/shops/${seller.shopId}/products`, seller.token)).status, 403);
      });
    }

    it("SELLER without a shop → 403", async () => {
      const seller = await createActor(["CUSTOMER", "SELLER"]);
      assert.equal((await call("/fixtures/seller/products", seller.token)).status, 403);
    });

    it("an APPROVED shop owner without the SELLER role → 403", async () => {
      const owner = await createActor(["CUSTOMER"], "APPROVED");
      assert.equal((await call("/fixtures/seller/products", owner.token)).status, 403);
    });

    it("a shop suspended in PostgreSQL is blocked on the next request", async () => {
      const seller = await createActor(["CUSTOMER", "SELLER"], "APPROVED");
      assert.equal((await call("/fixtures/seller/products", seller.token)).status, 200);
      await prisma.shop.update({ where: { ownerUserId: seller.userId }, data: { status: "SUSPENDED" } });
      assert.equal((await call("/fixtures/seller/products", seller.token)).status, 403);
    });

    it("SELLER targeting another seller's shop or its resources → 404", async () => {
      const seller = await createActor(["CUSTOMER", "SELLER"], "APPROVED");
      const other = await createActor(["CUSTOMER", "SELLER"], "APPROVED");
      assert.equal((await call(`/fixtures/seller/shops/${other.shopId}/products`, seller.token)).status, 404);
      assert.equal((await call(`/fixtures/seller/shops/${seller.shopId}/products`, seller.token)).status, 200);
    });

    it("a body, header, or query claiming status APPROVED, another shop ID, or SELLER does not change the outcome", async () => {
      const pending = await createActor(["CUSTOMER", "SELLER"], "PENDING");
      const approved = await createActor(["CUSTOMER", "SELLER"], "APPROVED");
      const response = await call(`/fixtures/seller/products?status=APPROVED&shopId=${approved.shopId}`, pending.token, {
        method: "POST",
        headers: { "x-shop-id": approved.shopId ?? "", "x-shop-status": "APPROVED" },
        body: JSON.stringify({ status: "APPROVED", shopId: approved.shopId, ownerUserId: pending.userId, role: "SELLER" }),
      });
      assert.equal(response.status, 403);

      const own = await call("/fixtures/seller/products", approved.token, {
        method: "POST",
        body: JSON.stringify({ shopId: pending.shopId }),
      });
      assert.deepEqual(await own.json(), { shopId: approved.shopId });
    });

    it("a shop owner cannot approve, reject, suspend, or reinstate their own shop → 403", async () => {
      for (const status of ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const) {
        const owner = await createActor(["CUSTOMER", "SELLER"], status);
        for (const action of ["approve", "reject", "suspend", "reinstate"]) {
          const response = await call(`/fixtures/admin/shops/${owner.shopId}/${action}`, owner.token, {
            method: "POST",
            body: JSON.stringify({ status: "APPROVED" }),
          });
          assert.equal(response.status, 403, `${status} ${action}`);
        }
        const shop = await prisma.shop.findUniqueOrThrow({ where: { ownerUserId: owner.userId } });
        assert.equal(shop.status, status);
      }
    });

    it("CUSTOMER → 403; unauthenticated → 401", async () => {
      const customer = await createActor(["CUSTOMER"]);
      assert.equal((await call("/fixtures/seller/products", customer.token)).status, 403);
      assert.equal((await call("/fixtures/seller/products", null)).status, 401);
      assert.equal((await call("/fixtures/customer/private", null)).status, 401);
      assert.equal((await call("/fixtures/admin/shops/x/approve", null, { method: "POST" })).status, 401);
    });
  });

  describe("database constraints", () => {
    it("rejects a duplicate supabaseUserId and a second shop for the same user", async () => {
      const actor = await createActor(["CUSTOMER"], "PENDING");
      await assert.rejects(prisma.user.create({ data: { supabaseUserId: actor.sub } }), { code: "P2002" });
      await assert.rejects(prisma.shop.create({ data: { ownerUserId: actor.userId } }), { code: "P2002" });
      await assert.rejects(prisma.userRole.create({ data: { userId: actor.userId, role: "CUSTOMER" } }), { code: "P2002" });
    });
  });
});
