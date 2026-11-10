import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  PAYMENT_SUMMARY_MAX_DAYS,
  paymentNoteSchema,
  periodDays,
  sellerPaymentSummaryQuerySchema,
  type AdminPaymentEvent,
  type AdminShopOrderDetail,
  type CustomerOrder,
  type SellerDelivery,
  type SellerPaymentSummary,
  type SellerShopOrderDetail,
} from "@chicman/shared";
import dotenv from "dotenv";

import { Prisma } from "../src/generated/prisma/client.js";
import { createOrder } from "../src/modules/orders/index.js";
import { createPayment } from "../src/modules/payments/index.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const NOTE = "Le client conteste le montant payé au livreur.";

describe("payment contract (spec 13)", () => {
  it("takes a correction note's reason as plain text of 10–500 characters, and nothing else", () => {
    assert.deepEqual(paymentNoteSchema.parse({ reason: NOTE }), { reason: NOTE });
    assert.equal(paymentNoteSchema.safeParse({ reason: "x".repeat(10) }).success, true);
    assert.equal(paymentNoteSchema.safeParse({ reason: "x".repeat(500) }).success, true);
    for (const body of [
      {},
      { reason: "trop court".slice(0, 9) },
      { reason: "x".repeat(501) },
      { reason: 1234567890 },
      { reason: "Ligne une\u0000 ligne deux" },
      { reason: NOTE, status: "CANCELLED" },
      { reason: NOTE, amount: "0.00" },
    ]) {
      assert.equal(paymentNoteSchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });

  it("takes a summary period of UTC days, both required, in order, at most 366 days", () => {
    assert.equal(PAYMENT_SUMMARY_MAX_DAYS, 366);
    assert.equal(periodDays("2026-01-01", "2026-01-01"), 1);
    assert.equal(periodDays("2024-01-01", "2024-12-31"), 366);
    assert.deepEqual(sellerPaymentSummaryQuerySchema.parse({ from: "2026-01-01", to: "2026-12-31" }), { from: "2026-01-01", to: "2026-12-31" });
    assert.equal(sellerPaymentSummaryQuerySchema.safeParse({ from: "2024-01-01", to: "2024-12-31" }).success, true);
    for (const query of [
      {},
      { from: "2026-01-01" },
      { to: "2026-01-01" },
      { from: "2026-02-01", to: "2026-01-31" },
      { from: "2024-01-01", to: "2025-01-01" },
      { from: "2026-02-30", to: "2026-03-01" },
      { from: "2026-01-01T00:00:00Z", to: "2026-01-02" },
      { from: "2026-01-01", to: "2026-01-02", shopId: randomUUID() },
    ]) {
      assert.equal(sellerPaymentSummaryQuerySchema.safeParse(query).success, false, JSON.stringify(query));
    }
  });
});

describe("cash on delivery (spec 13, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let otherSeller: Actor;
  let otherShopId: string;
  let customer: Actor;
  let admin: Actor;

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: shopId }, data: { shopName: "Boutique Alpha", deliveryFee: "100.00" } });
    ({ owner: otherSeller, shopId: otherShopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: otherShopId }, data: { shopName: "Boutique Beta", deliveryFee: "50.00" } });
    customer = await h.actor();
    admin = await h.actor(["CUSTOMER", "ADMIN"]);
  });

  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", ...(body === undefined ? {} : { body }) });
  const get = (path: string, actor: Actor | null) => h.call(path, actor?.token ?? null);

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  async function product(shop: string): Promise<string> {
    const created = await h.prisma.product.create({
      data: { shopId: shop, name: "Melhfa", description: "Voile léger.", category: "CLOTHING", price: "1500.00", stock: 50, status: "PUBLISHED", publishedAt: new Date() },
    });
    return created.id;
  }

  /** Places a one-shop order of `quantity` units as checkout does (spec 10). Amount due: 1,500 × quantity + the shop's fee. */
  async function place(shop: string, quantity = 2) {
    const productId = await product(shop);
    return h.prisma.$transaction(async (tx) => {
      const row = await tx.shop.findUniqueOrThrow({ where: { id: shop } });
      const p = await tx.product.findUniqueOrThrow({ where: { id: productId } });
      const order = await createOrder(tx, {
        customerUserId: customer.userId,
        idempotencyKey: randomUUID(),
        placedAt: new Date(),
        responseTimeoutHours: 48,
        delivery: {
          recipientName: "Aïcha Mint Ahmed",
          deliveryPhone: "+22233000000",
          label: "Maison",
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
            shopId: shop,
            shopName: row.shopName,
            contactPhone: row.contactPhone,
            whatsappPhone: row.whatsappPhone,
            deliveryFee: row.deliveryFee ?? new Prisma.Decimal(0),
            items: [{ productId: p.id, variantId: null, productName: p.name, size: null, color: null, imageObjectKey: null, unitPrice: p.price, quantity }],
          },
        ],
      });
      const shopOrder = order.shopOrders[0];
      assert.ok(shopOrder !== undefined);
      await createPayment(tx, { shopOrderId: shopOrder.id, amountDue: shopOrder.total, customerUserId: customer.userId });
      return { id: shopOrder.id, orderId: order.id };
    });
  }

  const delivery = (id: string, action: string) => `/sellers/me/orders/${id}/delivery/${action}`;

  /** A shop order delivered with cash received: payment `COLLECTED`. */
  async function collected(owner = seller, shop = shopId, quantity = 2) {
    const placed = await place(shop, quantity);
    assert.equal((await post(`/sellers/me/orders/${placed.id}/confirm`, owner)).status, 200);
    assert.equal((await post(delivery(placed.id, "dispatch"), owner)).status, 200);
    const due = (1500 * quantity + (shop === shopId ? 100 : 50)).toFixed(2);
    assert.equal((await post(delivery(placed.id, "delivered"), owner, { amount: due })).status, 200);
    return placed;
  }

  /** A shop order closed as undeliverable: payment `FAILED`. */
  async function failed() {
    const placed = await place(shopId);
    await post(`/sellers/me/orders/${placed.id}/confirm`, seller);
    await post(delivery(placed.id, "dispatch"), seller);
    await post(delivery(placed.id, "fail"), seller, { reason: "CUSTOMER_COULD_NOT_PAY" });
    assert.equal((await post(delivery(placed.id, "close"), seller)).status, 200);
    return placed;
  }

  /** A rejected shop order: payment `CANCELLED`. */
  async function cancelled() {
    const placed = await place(shopId);
    assert.equal((await post(`/sellers/me/orders/${placed.id}/reject`, seller, { reason: "OUT_OF_STOCK" })).status, 200);
    return placed;
  }

  const paymentOf = (id: string) => h.prisma.payment.findUniqueOrThrow({ where: { shopOrderId: id }, include: { events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
  const today = () => new Date().toISOString().slice(0, 10);
  const summary = async (actor: Actor | null, from = today(), to = today()) => get(`/sellers/me/payments/summary?from=${from}&to=${to}`, actor);

  describe("visibility (section 10)", () => {
    it("the customer sees method, amount due, and status only; the seller also the collection time and amount", async () => {
      const { id, orderId } = await place(shopId);
      await post(`/sellers/me/orders/${id}/confirm`, seller);
      await post(delivery(id, "dispatch"), seller);

      const before = (await (await get(`/sellers/me/orders/${id}`, seller)).json()) as SellerShopOrderDetail;
      assert.deepEqual(before.payment, { method: "CASH_ON_DELIVERY", amountDue: "3100.00", status: "PENDING", collectedAmount: null, collectedAt: null });

      const action = (await (await post(delivery(id, "delivered"), seller, { amount: "3100.00" })).json()) as SellerDelivery;
      const stored = await paymentOf(id);
      const collectedAt = stored.collectedAt?.toISOString();
      assert.ok(collectedAt !== undefined);
      const sellerPayment = { method: "CASH_ON_DELIVERY", amountDue: "3100.00", status: "COLLECTED", collectedAmount: "3100.00", collectedAt };
      assert.deepEqual(action.payment, sellerPayment);
      assert.deepEqual(((await (await get(`/sellers/me/orders/${id}`, seller)).json()) as SellerShopOrderDetail).payment, sellerPayment);

      const order = (await (await get(`/customers/me/orders/${orderId}`, customer)).json()) as CustomerOrder;
      assert.equal(order.paymentMethod, "CASH_ON_DELIVERY");
      assert.deepEqual(order.shopOrders[0]?.payment, { method: "CASH_ON_DELIVERY", amountDue: "3100.00", status: "COLLECTED" });
    });
  });

  describe("administrator correction notes (section 7)", () => {
    const notes = (id: string) => `/admin/orders/${id}/payment/notes`;

    it("appends an ADMIN_NOTE event with actor and time, and changes no status or amount, even on a final payment", async () => {
      const { id } = await collected();
      const before = await paymentOf(id);
      const response = await post(notes(id), admin, { reason: `  ${NOTE}  ` });
      assert.equal(response.status, 201);
      const event = (await response.json()) as AdminPaymentEvent;
      assert.equal(event.type, "ADMIN_NOTE");
      assert.equal(event.reason, NOTE);
      assert.equal(event.amount, null);
      assert.equal(event.actorType, "ADMIN");
      assert.equal(event.actorUserId, admin.userId);

      const after = await paymentOf(id);
      const { events: beforeEvents, ...beforeRecord } = before;
      const { events: afterEvents, ...afterRecord } = after;
      assert.deepEqual(afterRecord, beforeRecord, "status, amounts, and collection unchanged");
      assert.deepEqual(afterEvents.slice(0, beforeEvents.length), beforeEvents, "earlier events untouched");
      assert.deepEqual(
        afterEvents.map(({ type }) => type),
        ["CREATED", "COLLECTED", "ADMIN_NOTE"],
      );
      assert.equal(afterEvents[2]?.id, event.id);

      // A second note is appended, never replacing the first.
      assert.equal((await post(notes(id), admin, { reason: "Montant confirmé par la boutique." })).status, 201);
      const detail = (await (await get(`/admin/orders/${id}`, admin)).json()) as AdminShopOrderDetail;
      assert.deepEqual(
        detail.payment.events.map(({ type, reason }) => [type, reason]),
        [
          ["CREATED", null],
          ["COLLECTED", null],
          ["ADMIN_NOTE", NOTE],
          ["ADMIN_NOTE", "Montant confirmé par la boutique."],
        ],
      );
      assert.equal(detail.payment.status, "COLLECTED");
      assert.equal(detail.payment.collectedAmount, "3100.00");
    });

    it("works on pending, failed, and cancelled payments without changing them", async () => {
      for (const placed of [await place(shopId), await failed(), await cancelled()]) {
        const before = await paymentOf(placed.id);
        assert.equal((await post(notes(placed.id), admin, { reason: NOTE })).status, 201);
        const after = await paymentOf(placed.id);
        assert.equal(after.status, before.status);
        assert.equal(after.amountDue.toFixed(2), before.amountDue.toFixed(2));
        assert.equal(after.updatedAt.getTime(), before.updatedAt.getTime());
        assert.equal(after.events.length, before.events.length + 1);
      }
    });

    it("never reaches the customer or the seller", async () => {
      const { id, orderId } = await collected();
      await post(notes(id), admin, { reason: NOTE });
      for (const response of [
        await get(`/customers/me/orders/${orderId}`, customer),
        await get("/customers/me/orders", customer),
        await get(`/sellers/me/orders/${id}`, seller),
        await get("/sellers/me/orders", seller),
        await summary(seller),
      ]) {
        assert.equal(response.status, 200);
        const text = await response.text();
        assert.equal(text.includes(NOTE), false);
        assert.equal(text.includes("ADMIN_NOTE"), false);
      }
      const notifications = await h.prisma.notification.findMany();
      assert.equal(JSON.stringify(notifications).includes(NOTE), false);
    });

    it("is refused on a shop the administrator owns (403), and writes nothing", async () => {
      const { owner: adminOwner, shopId: ownShop } = await h.shopInStatus("APPROVED", await h.actor(["CUSTOMER", "SELLER", "ADMIN"]));
      await h.prisma.shop.update({ where: { id: ownShop }, data: { deliveryFee: "50.00" } });
      const { id } = await place(ownShop);
      const before = await paymentOf(id);
      await expectError(await post(notes(id), adminOwner, { reason: NOTE }), 403, "SHOP_SELF_ADMINISTRATION_FORBIDDEN");
      assert.deepEqual(await paymentOf(id), before);
      // Another administrator may.
      assert.equal((await post(notes(id), admin, { reason: NOTE })).status, 201);
    });

    it("refuses invalid bodies (400), unknown shop orders (404), and non-administrators, writing nothing", async () => {
      const { id } = await collected();
      const count = () => h.prisma.paymentEvent.count();
      const before = await count();
      for (const body of [{}, { reason: "court" }, { reason: 1234567890 }, { reason: "x".repeat(501) }, { reason: NOTE, status: "CANCELLED" }, { note: NOTE }]) {
        await expectError(await post(notes(id), admin, body), 400, "BAD_REQUEST");
      }
      await expectError(await post(notes(randomUUID()), admin, { reason: NOTE }), 404, "SHOP_ORDER_NOT_FOUND");
      await expectError(await post(notes("not-a-uuid"), admin, { reason: NOTE }), 404, "SHOP_ORDER_NOT_FOUND");
      await expectError(await post(notes(id), seller, { reason: NOTE }), 403, "FORBIDDEN");
      await expectError(await post(notes(id), customer, { reason: NOTE }), 403, "FORBIDDEN");
      assert.equal((await h.call(notes(id), null, { method: "POST", body: { reason: NOTE } })).status, 401);
      assert.equal(await count(), before);
    });

    it("no route edits or deletes payment events", async () => {
      const { id } = await collected();
      await post(notes(id), admin, { reason: NOTE });
      const before = await paymentOf(id);
      const eventId = before.events[2]?.id ?? "";
      for (const method of ["PUT", "PATCH", "DELETE"]) {
        assert.equal((await h.call(notes(id), admin.token, { method, body: { reason: "Remplacé par autre chose." } })).status, 404);
        assert.equal((await h.call(`${notes(id)}/${eventId}`, admin.token, { method, body: { reason: "Remplacé par autre chose." } })).status, 404);
      }
      assert.deepEqual(await paymentOf(id), before);
    });
  });

  describe("collection summary (section 9)", () => {
    it("counts and sums the seller's payments by status, matching the persisted payments", async () => {
      await collected(seller, shopId, 1); // 1,600.00
      await collected(seller, shopId, 2); // 3,100.00
      await place(shopId, 3); // pending 4,600.00
      await place(shopId, 1); // pending 1,600.00
      await failed();
      await cancelled();
      await cancelled();
      // Another seller's payments never count.
      await collected(otherSeller, otherShopId, 1);
      await place(otherShopId);

      const response = await summary(seller);
      assert.equal(response.status, 200);
      const body = (await response.json()) as SellerPaymentSummary;
      assert.deepEqual(body, {
        from: today(),
        to: today(),
        collected: { count: 2, total: "4700.00" },
        pending: { count: 2, total: "6200.00" },
        failed: { count: 1 },
        cancelled: { count: 2 },
      });

      // Reconciliation: straight from the records.
      const payments = await h.prisma.payment.findMany({ where: { shopOrder: { shopId } } });
      const sum = (status: string, field: "amountDue" | "collectedAmount") =>
        payments.filter((p) => p.status === status).reduce((total, p) => total.add(p[field] ?? 0), new Prisma.Decimal(0)).toFixed(2);
      assert.equal(body.collected.total, sum("COLLECTED", "collectedAmount"));
      assert.equal(body.collected.total, sum("COLLECTED", "amountDue"), "collected always equals due");
      assert.equal(body.pending.total, sum("PENDING", "amountDue"));
      assert.equal(body.collected.count + body.pending.count + body.failed.count + body.cancelled.count, payments.length);
    });

    it("selects the shop orders placed in the period, UTC days with both ends included", async () => {
      const inside = await place(shopId, 1);
      const lastMoment = await place(shopId, 2);
      const before = await place(shopId, 3);
      const afterPeriod = await place(shopId, 4);
      const at = (id: string, iso: string) => h.prisma.shopOrder.update({ where: { id }, data: { createdAt: new Date(iso) } });
      await at(inside.id, "2026-03-01T00:00:00.000Z");
      await at(lastMoment.id, "2026-03-31T23:59:59.999Z");
      await at(before.id, "2026-02-28T23:59:59.999Z");
      await at(afterPeriod.id, "2026-04-01T00:00:00.000Z");
      const body = (await (await summary(seller, "2026-03-01", "2026-03-31")).json()) as SellerPaymentSummary;
      assert.deepEqual(body.pending, { count: 2, total: "4700.00" });

      const empty = (await (await summary(seller, "2025-01-01", "2025-12-31")).json()) as SellerPaymentSummary;
      assert.deepEqual(empty, {
        from: "2025-01-01",
        to: "2025-12-31",
        collected: { count: 0, total: "0.00" },
        pending: { count: 0, total: "0.00" },
        failed: { count: 0 },
        cancelled: { count: 0 },
      });
    });

    it("refuses invalid periods (400) and anyone but the owner of an approved shop", async () => {
      for (const query of ["", "?from=2026-01-01", "?from=2026-02-01&to=2026-01-31", "?from=2024-01-01&to=2025-01-01", "?from=x&to=y", `?from=2026-01-01&to=2026-01-02&shopId=${otherShopId}`]) {
        await expectError(await get(`/sellers/me/payments/summary${query}`, seller), 400, "BAD_REQUEST");
      }
      assert.equal((await summary(seller, "2024-01-01", "2024-12-31")).status, 200, "366 days is allowed");
      await expectError(await summary(customer), 403, "FORBIDDEN");
      assert.equal((await summary(null)).status, 401);
      const { owner: pendingOwner } = await h.shopInStatus("PENDING");
      assert.equal((await summary(pendingOwner)).status, 403);
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal((await summary(seller)).status, 403);
    });
  });
});
