import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  ACCOUNT_TYPES,
  buyerAccountSetupSchema,
  REGISTRABLE_ACCOUNT_TYPES,
  registrationIntentSchema,
  sellerAccountSetupSchema,
  type AccountType,
  type Role,
} from "@chicman/shared";
import dotenv from "dotenv";

import type { Prisma } from "../src/generated/prisma/client.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { buildClassificationPlan, classifyAccount, type AccountSnapshot } from "../src/modules/accounts/account-classification.js";
import { applyClassificationPlanIn, loadAccountSnapshots } from "../src/modules/accounts/account-classification.repository.js";
import { deactivateAdministrator, provisionAdministrator, purgeExpiredRegistrationIntents } from "../src/modules/accounts/index.js";
import { resetDatabase, TEST_SHOP_FIELDS } from "./helpers/database.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const NO_BUYER_DATA = { orders: 0, addresses: 0, cartItems: 0, favorites: 0 };

function snapshot(overrides: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    userId: randomUUID(),
    supabaseUserId: randomUUID(),
    roles: ["CUSTOMER"],
    accountType: null,
    hasProfile: true,
    shop: null,
    buyer: NO_BUYER_DATA,
    notifications: 0,
    ...overrides,
  };
}

describe("AT-1 shared contracts", () => {
  it("lists three account types, of which only buyer and seller are registrable", () => {
    assert.deepEqual([...ACCOUNT_TYPES], ["BUYER", "SELLER", "ADMIN"]);
    assert.deepEqual([...REGISTRABLE_ACCOUNT_TYPES], ["BUYER", "SELLER"]);
  });

  it("accepts a buyer or seller registration intent and never ADMIN", () => {
    const supabaseUserId = randomUUID();
    assert.ok(registrationIntentSchema.safeParse({ supabaseUserId, accountType: "BUYER" }).success);
    assert.ok(registrationIntentSchema.safeParse({ supabaseUserId, accountType: "SELLER" }).success);
    assert.equal(registrationIntentSchema.safeParse({ supabaseUserId, accountType: "ADMIN" }).success, false);
    assert.equal(registrationIntentSchema.safeParse({ supabaseUserId: "not-a-uuid", accountType: "BUYER" }).success, false);
    assert.equal(registrationIntentSchema.safeParse({ supabaseUserId, accountType: "BUYER", roles: ["ADMIN"] }).success, false);
  });

  it("never lets a setup body carry the account type", () => {
    assert.ok(buyerAccountSetupSchema.safeParse({ phone: "36000000" }).success);
    assert.equal(buyerAccountSetupSchema.safeParse({ phone: "36000000", accountType: "SELLER" }).success, false);
    assert.ok(sellerAccountSetupSchema.safeParse({ phone: "36000000", shop: TEST_SHOP_FIELDS }).success);
    assert.equal(sellerAccountSetupSchema.safeParse({ phone: "36000000" }).success, false);
    assert.equal(sellerAccountSetupSchema.safeParse({ phone: "36000000", shop: TEST_SHOP_FIELDS, accountType: "ADMIN" }).success, false);
    assert.equal(sellerAccountSetupSchema.safeParse({ phone: "36000000", shop: { ...TEST_SHOP_FIELDS, status: "APPROVED" } }).success, false);
  });
});

describe("AT-1 classification rule (section 11.2)", () => {
  const approvedShop = { status: "APPROVED" as const, products: 5, shopOrders: 0 };

  it("classifies by the strongest role, and a shop owner as a seller", () => {
    const cases: [Role[], AccountSnapshot["shop"], string][] = [
      [["CUSTOMER"], null, "BUYER"],
      [["CUSTOMER", "SELLER"], approvedShop, "SELLER"],
      [["CUSTOMER"], { status: "PENDING", products: 0, shopOrders: 0 }, "SELLER"],
      [["CUSTOMER"], { status: "REJECTED", products: 0, shopOrders: 0 }, "SELLER"],
      [["ADMIN", "CUSTOMER"], null, "ADMIN"],
      [["ADMIN", "CUSTOMER", "SELLER"], approvedShop, "ADMIN"],
    ];
    for (const [roles, shop, expected] of cases) {
      const result = classifyAccount(snapshot({ roles, shop }));
      assert.equal(result.kind, "classify", roles.join("+"));
      assert.equal(result.kind === "classify" ? result.accountType : null, expected, roles.join("+"));
    }
  });

  it("reports, never removes, the data the new type cannot reach (development account A)", () => {
    const result = classifyAccount(
      snapshot({
        roles: ["ADMIN", "CUSTOMER", "SELLER"],
        shop: approvedShop,
        buyer: { orders: 1, addresses: 1, cartItems: 2, favorites: 0 },
        notifications: 4,
      }),
    );
    assert.deepEqual(result, {
      kind: "classify",
      accountType: "ADMIN",
      incompatible: ["SHOP_OWNED_BY_ADMIN", "BUYER_ORDERS", "BUYER_ADDRESSES", "BUYER_CART", "NOTIFICATIONS_WITHOUT_INBOX"],
    });
  });

  it("keeps a seller's notifications (sellers have an inbox) and reports its buyer data (development account B)", () => {
    const result = classifyAccount(
      snapshot({ roles: ["CUSTOMER", "SELLER"], shop: { status: "APPROVED", products: 1, shopOrders: 1 }, buyer: { ...NO_BUYER_DATA, addresses: 1, cartItems: 1 }, notifications: 2 }),
    );
    assert.deepEqual(result, { kind: "classify", accountType: "SELLER", incompatible: ["BUYER_ADDRESSES", "BUYER_CART"] });
  });

  it("blocks an account without any role or whose type is already different", () => {
    assert.deepEqual(classifyAccount(snapshot({ roles: [] })), { kind: "blocked", reason: "NO_ROLE", proposed: null });
    assert.deepEqual(classifyAccount(snapshot({ roles: ["ADMIN"], accountType: "SELLER" })), { kind: "blocked", reason: "TYPE_ALREADY_DIFFERENT", proposed: "ADMIN" });
    assert.deepEqual(classifyAccount(snapshot({ roles: ["CUSTOMER"], accountType: "BUYER" })), { kind: "unchanged", accountType: "BUYER", incompatible: [] });
  });

  it("gives a digest that depends only on the writes, whatever the input order", () => {
    const a = snapshot({ userId: "00000000-0000-4000-8000-000000000001" });
    const b = snapshot({ userId: "00000000-0000-4000-8000-000000000002", roles: ["CUSTOMER", "SELLER"] });
    const first = buildClassificationPlan([a, b]);
    assert.equal(buildClassificationPlan([b, a]).digest, first.digest);
    assert.notEqual(buildClassificationPlan([a, { ...b, roles: ["ADMIN"] }]).digest, first.digest);
    assert.deepEqual(first.writes, [
      { userId: a.userId, accountType: "BUYER" },
      { userId: b.userId, accountType: "SELLER" },
    ]);
  });
});

describe("AT-1 database rules, classification, and administrator access (PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  let prisma: PrismaClient;

  before(() => {
    prisma = createPrismaClient(databaseUrl ?? "");
  });
  after(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  async function account(accountType: AccountType, options: { phone?: string | null; supabaseUserId?: string } = {}) {
    const created = await prisma.user.create({
      data: {
        supabaseUserId: options.supabaseUserId ?? randomUUID(),
        accountType,
        customerProfile: { create: { phone: options.phone === undefined ? "+22236000000" : options.phone } },
      },
      select: { id: true },
    });
    return created.id;
  }

  const typeOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id }, select: { accountType: true } })).accountType;

  it("never changes an account type", async () => {
    const id = await account("BUYER");
    await prisma.user.update({ where: { id }, data: { accountType: "BUYER" } });
    for (const other of ["SELLER", "ADMIN"] as const) await assert.rejects(prisma.user.update({ where: { id }, data: { accountType: other } }));
    await assert.rejects(prisma.$executeRaw`UPDATE "User" SET "accountType" = NULL WHERE "id" = ${id}::uuid`);
    assert.equal(await typeOf(id), "BUYER");
  });

  it("lets only a Seller account own a shop, including through a transfer", async () => {
    for (const type of ["BUYER", "ADMIN"] as const) {
      await assert.rejects(prisma.shop.create({ data: { ownerUserId: await account(type), ...TEST_SHOP_FIELDS } }));
    }
    const shop = await prisma.shop.create({ data: { ownerUserId: await account("SELLER"), ...TEST_SHOP_FIELDS }, select: { id: true } });
    await assert.rejects(prisma.shop.update({ where: { id: shop.id }, data: { ownerUserId: await account("BUYER") } }));
    await prisma.shop.update({ where: { id: shop.id }, data: { ownerUserId: await account("SELLER") } });
  });

  it("gives carts and delivery addresses to Buyer accounts only", async () => {
    const address = { city: "Nouakchott", district: "Tevragh Zeina", landmark: "Près de la mosquée", latitude: "18.0858", longitude: "-15.9785", locationSource: "MANUAL" as const, locationConfirmedAt: new Date() };
    for (const type of ["SELLER", "ADMIN"] as const) {
      const id = await account(type);
      await assert.rejects(prisma.cart.create({ data: { userId: id } }));
      await assert.rejects(prisma.customerAddress.create({ data: { userId: id, ...address } }));
    }
    const buyer = await account("BUYER");
    await prisma.cart.create({ data: { userId: buyer } });
    await prisma.customerAddress.create({ data: { userId: buyer, ...address } });
  });

  it("requires the personal phone for Buyers and Sellers, not for Administrators (Q3)", async () => {
    for (const type of ["BUYER", "SELLER"] as const) await assert.rejects(account(type, { phone: null }));
    const admin = await account("ADMIN", { phone: null });
    const buyer = await account("BUYER");
    await assert.rejects(prisma.customerProfile.update({ where: { userId: buyer }, data: { phone: null } }));
    assert.equal((await prisma.customerProfile.findUniqueOrThrow({ where: { userId: admin } })).phone, null);
  });

  it("allows administrator deactivation on an ADMIN account only", async () => {
    const buyer = await account("BUYER");
    await assert.rejects(prisma.user.update({ where: { id: buyer }, data: { adminAccessDeactivatedAt: new Date() } }));
    const admin = await account("ADMIN");
    await prisma.user.update({ where: { id: admin }, data: { adminAccessDeactivatedAt: new Date() } });
  });

  it("accepts only buyer and seller registration intents, one per identity", async () => {
    const supabaseUserId = randomUUID();
    await prisma.registrationIntent.create({ data: { supabaseUserId, accountType: "SELLER" } });
    await assert.rejects(prisma.registrationIntent.create({ data: { supabaseUserId, accountType: "BUYER" } }));
    await assert.rejects(prisma.registrationIntent.create({ data: { supabaseUserId: randomUUID(), accountType: "ADMIN" } }));
  });

  it("requires a reason and two different owners on a shop ownership record", async () => {
    const from = await account("SELLER");
    const to = await account("SELLER");
    const shop = await prisma.shop.create({ data: { ownerUserId: from, ...TEST_SHOP_FIELDS }, select: { id: true } });
    await assert.rejects(prisma.shopOwnershipEvent.create({ data: { shopId: shop.id, fromUserId: from, toUserId: from, reason: "Transfert approuvé" } }));
    await assert.rejects(prisma.shopOwnershipEvent.create({ data: { shopId: shop.id, fromUserId: from, toUserId: to, reason: "   " } }));
    await prisma.shopOwnershipEvent.create({ data: { shopId: shop.id, fromUserId: from, toUserId: to, reason: "Transfert approuvé" } });
  });

  it("deletes only unconsumed registration intents older than 30 days", async () => {
    const now = new Date("2026-12-31T00:00:00Z");
    const old = new Date("2026-11-30T23:59:59Z");
    const recent = new Date("2026-12-01T00:00:01Z");
    const [oldOpen, oldConsumed, recentOpen] = [randomUUID(), randomUUID(), randomUUID()];
    await prisma.registrationIntent.createMany({
      data: [
        { supabaseUserId: oldOpen, accountType: "BUYER", createdAt: old },
        { supabaseUserId: oldConsumed, accountType: "SELLER", createdAt: old, consumedAt: old },
        { supabaseUserId: recentOpen, accountType: "BUYER", createdAt: recent },
      ],
    });
    assert.equal(await purgeExpiredRegistrationIntents(prisma, now), 1);
    const left = (await prisma.registrationIntent.findMany({ select: { supabaseUserId: true } })).map(({ supabaseUserId }) => supabaseUserId).sort();
    assert.deepEqual(left, [oldConsumed, recentOpen].sort());
  });

  describe("administrator provisioning and deactivation (section 6, Q7)", () => {
    it("creates an Administrator for an identity without an account, phone optional, and removes its intent", async () => {
      const sub = randomUUID();
      await prisma.registrationIntent.create({ data: { supabaseUserId: sub, accountType: "BUYER" } });
      const outcome = await provisionAdministrator(prisma, sub);
      assert.equal(outcome.state, "provisioned");
      const created = await prisma.user.findUniqueOrThrow({ where: { supabaseUserId: sub }, select: { accountType: true, customerProfile: { select: { phone: true } } } });
      assert.deepEqual(created, { accountType: "ADMIN", customerProfile: { phone: null } });
      assert.equal(await prisma.registrationIntent.count({ where: { supabaseUserId: sub } }), 0);
      assert.equal((await provisionAdministrator(prisma, randomUUID(), { phone: "36 00 00 00" })).state, "provisioned");
      assert.equal((await provisionAdministrator(prisma, randomUUID(), { phone: "abc" })).state, "invalid-phone");
    });

    it("never converts an existing account", async () => {
      for (const type of ["BUYER", "SELLER", "ADMIN"] as const) {
        const sub = randomUUID();
        const id = await account(type, { supabaseUserId: sub });
        assert.deepEqual(await provisionAdministrator(prisma, sub), { state: "account-exists", accountType: type });
        assert.equal(await typeOf(id), type);
      }
    });

    it("deactivates once, with an audit record, and keeps the type", async () => {
      const sub = randomUUID();
      const id = await account("ADMIN", { supabaseUserId: sub });
      assert.equal((await deactivateAdministrator(prisma, sub, { reason: "court" })).state, "invalid-reason");
      assert.equal((await deactivateAdministrator(prisma, sub, { reason: "Départ de l'équipe Chicman" })).state, "deactivated");
      assert.equal((await deactivateAdministrator(prisma, sub, { reason: "Départ de l'équipe Chicman" })).state, "already-deactivated");
      assert.equal(await typeOf(id), "ADMIN");
      const events = await prisma.adminAccessEvent.findMany({ where: { userId: id } });
      assert.equal(events.length, 1);
      assert.equal(events[0]?.action, "DEACTIVATED");
      const buyerSub = randomUUID();
      await account("BUYER", { supabaseUserId: buyerSub });
      assert.equal((await deactivateAdministrator(prisma, buyerSub, { reason: "Départ de l'équipe Chicman" })).state, "not-admin");
      assert.equal((await deactivateAdministrator(prisma, randomUUID(), { reason: "Départ de l'équipe Chicman" })).state, "not-found");
    });
  });

  describe("classification apply, on a simulated database before the contract migration", () => {
    class Rollback extends Error {}

    /** Runs `body` where `User.accountType` is nullable again, then rolls everything back (DDL included). */
    async function beforeContract(body: (tx: Prisma.TransactionClient) => Promise<void>): Promise<void> {
      await assert.rejects(
        prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "accountType" DROP NOT NULL`);
          await body(tx);
          throw new Rollback();
        }),
        Rollback,
      );
    }

    async function legacyUser(tx: Prisma.TransactionClient, roles: Role[]): Promise<string> {
      const [row] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "User" ("id", "supabaseUserId", "updatedAt") VALUES (gen_random_uuid(), gen_random_uuid(), now()) RETURNING "id"`;
      const id = row?.id ?? "";
      for (const role of roles) await tx.$executeRaw`INSERT INTO "UserRole" ("userId", "role") VALUES (${id}::uuid, ${role}::"Role")`;
      return id;
    }

    const typeIn = async (tx: Prisma.TransactionClient, id: string) =>
      (await tx.$queryRaw<{ accountType: string | null }[]>`SELECT "accountType"::text AS "accountType" FROM "User" WHERE "id" = ${id}::uuid`)[0]?.accountType ?? null;

    it("writes exactly the approved plan, and only the account types", async () => {
      await beforeContract(async (tx) => {
        const buyer = await legacyUser(tx, ["CUSTOMER"]);
        const seller = await legacyUser(tx, ["CUSTOMER", "SELLER"]);
        const admin = await legacyUser(tx, ["ADMIN", "CUSTOMER", "SELLER"]);
        const roles = await tx.userRole.count();
        const plan = buildClassificationPlan(await loadAccountSnapshots(tx));
        assert.equal(plan.writes.length, 3);

        assert.equal((await applyClassificationPlanIn(tx, "0".repeat(64))).state, "digest-mismatch");
        assert.equal(await typeIn(tx, buyer), null);

        assert.equal((await applyClassificationPlanIn(tx, plan.digest)).state, "applied");
        assert.deepEqual([await typeIn(tx, buyer), await typeIn(tx, seller), await typeIn(tx, admin)], ["BUYER", "SELLER", "ADMIN"]);
        assert.equal(await tx.userRole.count(), roles);

        // A second run has nothing left to write.
        const again = buildClassificationPlan(await loadAccountSnapshots(tx));
        assert.equal(again.writes.length, 0);
      });
    });

    it("writes nothing while any account is blocked", async () => {
      await beforeContract(async (tx) => {
        const buyer = await legacyUser(tx, ["CUSTOMER"]);
        await legacyUser(tx, []);
        const plan = buildClassificationPlan(await loadAccountSnapshots(tx));
        assert.equal(plan.blocked, 1);
        assert.equal((await applyClassificationPlanIn(tx, plan.digest)).state, "blocked");
        assert.equal(await typeIn(tx, buyer), null);
      });
    });
  });
});
