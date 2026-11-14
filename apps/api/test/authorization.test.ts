import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { AccountType, ShopStatus } from "@chicman/shared";
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
import { resetDatabase, TEST_SHOP_FIELDS } from "./helpers/database.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

/**
 * Fixture routes that stand in for feature routes not built yet. They use the
 * production guards exactly as feature modules will.
 */
function fixtureRouter(guards: AuthGuards): Router {
  const router = Router();
  // Stand-in for account setup (AT-1): token only.
  router.post("/fixtures/bootstrap", ...guards.tokenOnly, (req, res) => {
    res.status(200).json({ hasUser: req.appUser !== null });
  });
  // A buyer-only route (cart, checkout, favorites, addresses, own orders).
  router.get("/fixtures/customer/private", ...guards.buyer, (_req, res) => {
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
    router.post(`/fixtures/admin/shops/:shopId/${action}`, ...guards.admin, (_req, res) => {
      res.status(204).end();
    });
  }
  return router;
}

describe("account type and seller authorization (spec 03, AT-1, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
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
    await resetDatabase(prisma);
  });

  interface Actor {
    sub: string;
    userId: string;
    token: string;
  }

  async function createActor(accountType: AccountType, shopStatus?: ShopStatus, extraClaims = {}): Promise<Actor & { shopId?: string }> {
    const sub = randomUUID();
    const user = await prisma.user.create({ data: { supabaseUserId: sub, accountType } });
    const shop =
      shopStatus === undefined
        ? undefined
        : await prisma.shop.create({ data: { ownerUserId: user.id, status: shopStatus, ...TEST_SHOP_FIELDS } });
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

  describe("account types come from PostgreSQL", () => {
    it("returns the account type for the verified sub", async () => {
      const actor = await createActor("SELLER", "APPROVED");
      const response = await call("/auth/session", actor.token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { userId: actor.userId, accountType: "SELLER" });
    });

    it("a Buyer claiming ADMIN or SELLER in token claims, headers, query, or body is still a Buyer", async () => {
      const actor = await createActor("BUYER", undefined, {
        role: "ADMIN",
        roles: ["ADMIN", "SELLER"],
        accountType: "ADMIN",
        app_metadata: { role: "ADMIN", roles: ["ADMIN"], accountType: "ADMIN" },
        user_metadata: { role: "SELLER", accountType: "SELLER" },
        user_role: "ADMIN",
      });
      const spoof = {
        headers: { "x-role": "ADMIN", "x-account-type": "ADMIN", "x-user-id": randomUUID(), "x-shop-id": randomUUID() },
        body: JSON.stringify({ role: "ADMIN", accountType: "ADMIN", roles: ["ADMIN", "SELLER"], userId: randomUUID(), status: "APPROVED" }),
      };
      const query = "?role=ADMIN&accountType=ADMIN&userId=x";

      const session = await call(`/auth/session${query}`, actor.token, { headers: spoof.headers });
      assert.deepEqual(await session.json(), { userId: actor.userId, accountType: "BUYER" });

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

    it("each type reaches only its own routes", async () => {
      const buyer = await createActor("BUYER");
      const seller = await createActor("SELLER", "APPROVED");
      const admin = await createActor("ADMIN");
      const routes = {
        buyer: () => "/fixtures/customer/private",
        seller: () => "/fixtures/seller/products",
        admin: () => `/fixtures/admin/shops/${randomUUID()}/approve`,
      };
      const expected: Record<string, Record<keyof typeof routes, number>> = {
        BUYER: { buyer: 200, seller: 403, admin: 403 },
        SELLER: { buyer: 403, seller: 200, admin: 403 },
        ADMIN: { buyer: 403, seller: 403, admin: 204 },
      };
      for (const [type, actor] of [["BUYER", buyer], ["SELLER", seller], ["ADMIN", admin]] as const) {
        for (const area of ["buyer", "seller", "admin"] as const) {
          const response = await call(routes[area](), actor.token, area === "admin" ? { method: "POST" } : {});
          assert.equal(response.status, expected[type]?.[area], `${type} on ${area}`);
        }
      }
    });

    it("a deactivated administrator is refused on the next request with the same token, and stays ADMIN (Q7)", async () => {
      const admin = await createActor("ADMIN");
      assert.equal((await call(`/fixtures/admin/shops/x/approve`, admin.token, { method: "POST" })).status, 204);
      await prisma.user.update({ where: { id: admin.userId }, data: { adminAccessDeactivatedAt: new Date() } });
      assert.equal((await call(`/fixtures/admin/shops/x/approve`, admin.token, { method: "POST" })).status, 403);
      assert.deepEqual(await (await call("/auth/session", admin.token)).json(), { userId: admin.userId, accountType: "ADMIN" });
    });
  });

  describe("normal seller operations (requireApprovedSeller)", () => {
    it("a Seller with an APPROVED shop they own → allowed", async () => {
      const seller = await createActor("SELLER", "APPROVED");
      const response = await call("/fixtures/seller/products", seller.token);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { shopId: seller.shopId });
    });

    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      it(`a Seller with a ${status} shop → 403`, async () => {
        const seller = await createActor("SELLER", status);
        assert.equal((await call("/fixtures/seller/products", seller.token)).status, 403);
        assert.equal((await call(`/fixtures/seller/shops/${seller.shopId}/products`, seller.token)).status, 403);
      });
    }

    it("a Seller without a shop → 403", async () => {
      const seller = await createActor("SELLER");
      assert.equal((await call("/fixtures/seller/products", seller.token)).status, 403);
    });

    it("a Buyer or Administrator owning an APPROVED shop (pre-AT-1 data) → 403", async () => {
      for (const type of ["BUYER", "ADMIN"] as const) {
        const owner = await createActor(type);
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`ALTER TABLE "Shop" DISABLE TRIGGER "Shop_owner_is_seller"`);
          await tx.shop.create({ data: { ownerUserId: owner.userId, status: "APPROVED", ...TEST_SHOP_FIELDS } });
          await tx.$executeRawUnsafe(`ALTER TABLE "Shop" ENABLE TRIGGER "Shop_owner_is_seller"`);
        });
        assert.equal((await call("/fixtures/seller/products", owner.token)).status, 403, type);
      }
    });

    it("a shop suspended in PostgreSQL is blocked on the next request", async () => {
      const seller = await createActor("SELLER", "APPROVED");
      assert.equal((await call("/fixtures/seller/products", seller.token)).status, 200);
      await prisma.shop.update({ where: { ownerUserId: seller.userId }, data: { status: "SUSPENDED" } });
      assert.equal((await call("/fixtures/seller/products", seller.token)).status, 403);
    });

    it("a Seller targeting another seller's shop or its resources → 404", async () => {
      const seller = await createActor("SELLER", "APPROVED");
      const other = await createActor("SELLER", "APPROVED");
      assert.equal((await call(`/fixtures/seller/shops/${other.shopId}/products`, seller.token)).status, 404);
      assert.equal((await call(`/fixtures/seller/shops/${seller.shopId}/products`, seller.token)).status, 200);
    });

    it("a body, header, or query claiming status APPROVED or another shop ID does not change the outcome", async () => {
      const pending = await createActor("SELLER", "PENDING");
      const approved = await createActor("SELLER", "APPROVED");
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
        const owner = await createActor("SELLER", status);
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

    it("a Buyer → 403; unauthenticated → 401", async () => {
      const customer = await createActor("BUYER");
      assert.equal((await call("/fixtures/seller/products", customer.token)).status, 403);
      assert.equal((await call("/fixtures/seller/products", null)).status, 401);
      assert.equal((await call("/fixtures/customer/private", null)).status, 401);
      assert.equal((await call("/fixtures/admin/shops/x/approve", null, { method: "POST" })).status, 401);
    });
  });

  describe("database constraints", () => {
    it("rejects a duplicate supabaseUserId and a second shop for the same user", async () => {
      const actor = await createActor("SELLER", "PENDING");
      await assert.rejects(prisma.user.create({ data: { supabaseUserId: actor.sub, accountType: "SELLER" } }), { code: "P2002" });
      await assert.rejects(prisma.shop.create({ data: { ownerUserId: actor.userId, ...TEST_SHOP_FIELDS } }), { code: "P2002" });
    });
  });
});
