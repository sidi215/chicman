import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import dotenv from "dotenv";

import { Prisma } from "../src/generated/prisma/client.js";
import { provisionSellerWithoutShop } from "../src/modules/accounts/index.js";
import { createOrder } from "../src/modules/orders/index.js";
import { applyShopTransfer, planShopTransfer, type ShopTransferInput } from "../src/modules/shops/index.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const REASON = "Transfert de la boutique test approuvé par le propriétaire du projet";

describe("seller provisioning and shop transfer (AT-1 phase 5, Q8, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");

  before(() => h.start());
  after(() => h.stop());
  beforeEach(() => h.reset());

  /** A Seller account without a shop, as `seller:provision` creates it, with a token. */
  async function provisionedSeller(): Promise<Actor> {
    const placeholder = await h.actor("BUYER");
    const sub = randomUUID();
    assert.equal((await provisionSellerWithoutShop(h.prisma, sub, "36 00 00 01")).state, "provisioned");
    const user = await h.prisma.user.findUniqueOrThrow({ where: { supabaseUserId: sub }, select: { id: true } });
    // A token for the new identity: same signing key, the new sub.
    const session = await h.newSession({ ...placeholder, sub });
    return { ...session, sub, userId: user.id };
  }

  async function product(shopId: string, name: string) {
    return h.prisma.product.create({
      data: { shopId, name, description: "Voile léger.", category: "CLOTHING", price: "1500.00", stock: 5, status: "PUBLISHED", publishedAt: new Date() },
    });
  }

  /** Development account A's situation: an Administrator owning an approved shop with published products (pre-AT-1 data). */
  async function accountA() {
    const admin = await h.actor("ADMIN");
    const { shopId } = await h.legacyShop("APPROVED", admin);
    for (const name of ["Melhfa", "Voile", "Daraa"]) await product(shopId, name);
    await h.prisma.shopStatusEvent.create({ data: { shopId, fromStatus: null, toStatus: "PENDING", actorUserId: admin.userId } });
    return { admin, shopId };
  }

  /** A PENDING shop order of `shopId`, placed as checkout does. */
  async function openOrder(shopId: string) {
    const buyer = await h.actor("BUYER");
    const item = await product(shopId, "Commande ouverte");
    await h.prisma.$transaction((tx) =>
      createOrder(tx, {
        customerUserId: buyer.userId,
        idempotencyKey: randomUUID(),
        placedAt: new Date(),
        responseTimeoutHours: 48,
        delivery: {
          recipientName: "Aïcha",
          deliveryPhone: "+22233000000",
          label: null,
          city: "Nouakchott",
          district: "Tevragh Zeina",
          landmark: "Près de la mosquée bleue",
          latitude: new Prisma.Decimal("18.086000"),
          longitude: new Prisma.Decimal("-15.975000"),
          locationSource: "MANUAL",
          accuracyMeters: null,
        },
        shops: [
          {
            shopId,
            shopName: "Boutique",
            contactPhone: "+22246000000",
            whatsappPhone: null,
            deliveryFee: new Prisma.Decimal("100.00"),
            items: [{ productId: item.id, variantId: null, productName: item.name, size: null, color: null, imageObjectKey: null, unitPrice: item.price, quantity: 1 }],
          },
        ],
      }),
    );
  }

  const input = (shopId: string, to: Actor, overrides: Partial<ShopTransferInput> = {}): ShopTransferInput => ({ shopId, toSupabaseUserId: to.sub, reason: REASON, ...overrides });

  describe("seller:provision", () => {
    it("creates a Seller account without a shop, with its required phone, and never converts an account", async () => {
      const sub = randomUUID();
      assert.equal((await provisionSellerWithoutShop(h.prisma, sub, "abc")).state, "invalid-phone");
      assert.equal((await provisionSellerWithoutShop(h.prisma, sub, "36 00 00 01")).state, "provisioned");
      const user = await h.prisma.user.findUniqueOrThrow({ where: { supabaseUserId: sub }, include: { shop: true, customerProfile: true } });
      assert.equal(user.accountType, "SELLER");
      assert.equal(user.shop, null);
      assert.equal(user.customerProfile?.phone, "+22236000001");
      for (const type of ["BUYER", "SELLER", "ADMIN"] as const) {
        const existing = await h.actor(type);
        assert.deepEqual(await provisionSellerWithoutShop(h.prisma, existing.sub, "36000001"), { state: "account-exists", accountType: type });
      }
    });

    it("refuses an identity that registered as a buyer, and consumes a seller intent", async () => {
      const buyerSub = randomUUID();
      await h.prisma.registrationIntent.create({ data: { supabaseUserId: buyerSub, accountType: "BUYER" } });
      assert.equal((await provisionSellerWithoutShop(h.prisma, buyerSub, "36000001")).state, "buyer-intent");
      assert.equal(await h.prisma.user.count({ where: { supabaseUserId: buyerSub } }), 0);
      const sellerSub = randomUUID();
      await h.prisma.registrationIntent.create({ data: { supabaseUserId: sellerSub, accountType: "SELLER" } });
      assert.equal((await provisionSellerWithoutShop(h.prisma, sellerSub, "36000001")).state, "provisioned");
      assert.notEqual((await h.prisma.registrationIntent.findUniqueOrThrow({ where: { supabaseUserId: sellerSub } })).consumedAt, null);
    });
  });

  describe("shop:transfer-owner", () => {
    it("moves account A's test shop to the new Seller with one audit record, after the exact reviewed transfer is approved", async () => {
      const { admin, shopId } = await accountA();
      const seller = await provisionedSeller();
      const historyBefore = await h.prisma.shopStatusEvent.findMany({ where: { shopId }, orderBy: { id: "asc" } });
      const productsBefore = await h.prisma.product.findMany({ where: { shopId }, orderBy: { id: "asc" } });

      const planned = await planShopTransfer(h.prisma, input(shopId, seller, { note: "Q8, 2026-11-13" }));
      assert.equal(planned.state, "ready");
      if (planned.state !== "ready") return;
      assert.deepEqual(planned.plan.from, { userId: admin.userId, supabaseUserId: admin.sub, accountType: "ADMIN" });
      assert.equal(planned.plan.shop.products, 3);
      // The dry run writes nothing.
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).ownerUserId, admin.userId);

      // Another transfer than the reviewed one (here, another reason) is not applied.
      const other = await applyShopTransfer(h.prisma, input(shopId, seller, { note: "Q8, 2026-11-13", reason: "Une autre raison, non relue" }), planned.plan.digest);
      assert.equal(other.state, "digest-mismatch");
      assert.equal(await h.prisma.shopOwnershipEvent.count(), 0);

      const applied = await applyShopTransfer(h.prisma, input(shopId, seller, { note: "Q8, 2026-11-13" }), planned.plan.digest);
      assert.equal(applied.state, "transferred");
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      assert.equal(shop.ownerUserId, seller.userId);
      assert.equal(shop.status, "APPROVED");
      const events = await h.prisma.shopOwnershipEvent.findMany();
      assert.equal(events.length, 1);
      assert.deepEqual(
        [events[0]?.shopId, events[0]?.fromUserId, events[0]?.toUserId, events[0]?.reason, events[0]?.operatorNote],
        [shopId, admin.userId, seller.userId, REASON, "Q8, 2026-11-13"],
      );
      // Nothing else changed: products, and the audit history with its original actors.
      assert.deepEqual(await h.prisma.product.findMany({ where: { shopId }, orderBy: { id: "asc" } }), productsBefore);
      assert.deepEqual(await h.prisma.shopStatusEvent.findMany({ where: { shopId }, orderBy: { id: "asc" } }), historyBefore);

      // The new Seller operates the shop; the Administrator no longer owns it and may now administer it.
      const list = await h.call("/sellers/me/products", seller.token);
      assert.equal(list.status, 200);
      assert.equal(((await list.json()) as { total: number }).total, 3);
      assert.equal((await h.call("/sellers/me/shop", admin.token)).status, 403);
      assert.equal((await h.call(`/admin/shops/${shopId}`, admin.token)).status, 200);

      // Running the approved transfer again changes nothing.
      const again = await applyShopTransfer(h.prisma, input(shopId, seller, { note: "Q8, 2026-11-13" }), planned.plan.digest);
      assert.deepEqual(again, { state: "refused", reason: "same-owner" });
      assert.equal(await h.prisma.shopOwnershipEvent.count(), 1);
    });

    it("refuses invalid reasons, unknown shops and targets, non-Seller targets, Sellers that own a shop, and open orders", async () => {
      const { shopId } = await accountA();
      const seller = await provisionedSeller();
      const refused = async (value: ShopTransferInput) => {
        const outcome = await planShopTransfer(h.prisma, value);
        return outcome.state === "refused" ? outcome.reason : outcome.state;
      };
      assert.equal(await refused(input(shopId, seller, { reason: "court" })), "invalid-reason");
      assert.equal(await refused(input(shopId, seller, { note: "" })), "invalid-note");
      assert.equal(await refused(input(randomUUID(), seller)), "shop-not-found");
      assert.equal(await refused({ shopId, toSupabaseUserId: randomUUID(), reason: REASON }), "target-not-found");
      for (const type of ["BUYER", "ADMIN"] as const) assert.equal(await refused(input(shopId, await h.actor(type))), "target-not-seller");
      const { owner: busy } = await h.shopInStatus("APPROVED");
      assert.equal(await refused(input(shopId, busy)), "target-has-shop");

      await openOrder(shopId);
      assert.deepEqual(await planShopTransfer(h.prisma, input(shopId, seller)), { state: "refused", reason: "open-orders", openOrders: 1 });
      assert.equal((await applyShopTransfer(h.prisma, input(shopId, seller), "0".repeat(64))).state, "refused");
      assert.equal(await h.prisma.shopOwnershipEvent.count(), 0);
    });

    it("never gives a shop to a non-Seller, even by a direct update (database trigger)", async () => {
      const { owner } = await h.shopInStatus("APPROVED");
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { ownerUserId: owner.userId } });
      for (const type of ["BUYER", "ADMIN"] as const) {
        await assert.rejects(h.prisma.shop.update({ where: { id: shop.id }, data: { ownerUserId: (await h.actor(type)).userId } }));
      }
    });
  });
});
