import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  DELIVERY_FAILURE_REASONS,
  deliveryDeliveredSchema,
  deliveryEmptyBodySchema,
  deliveryFailSchema,
  type AdminShopOrderDetail,
  type CustomerOrder,
  type SellerDelivery,
  type SellerInProgressDeliveriesResponse,
  type SellerShopOrderDetail,
} from "@chicman/shared";
import dotenv from "dotenv";

import { Prisma } from "../src/generated/prisma/client.js";
import { closeDueDeliveries } from "../src/modules/delivery/index.js";
import { createOrder } from "../src/modules/orders/index.js";
import { createPayment } from "../src/modules/payments/index.js";
import { createAdvisoryLock, DELIVERY_AUTO_CLOSE_LOCK_NAME } from "../src/workers/advisory-lock.js";
import { DELIVERY_FAILED_AUTO_CLOSE_DAYS, ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const DAY = 86_400_000;

describe("delivery contract (spec 12)", () => {
  it("requires a failure reason from the fixed list, with no free text", () => {
    assert.deepEqual(
      [...DELIVERY_FAILURE_REASONS],
      ["CUSTOMER_UNREACHABLE", "CUSTOMER_ABSENT", "CUSTOMER_REFUSED", "ADDRESS_NOT_FOUND", "CUSTOMER_COULD_NOT_PAY", "OTHER"],
    );
    for (const reason of DELIVERY_FAILURE_REASONS) assert.equal(deliveryFailSchema.safeParse({ reason }).success, true);
    for (const body of [{}, { reason: "LOST" }, { reason: "OTHER", reasonText: "texte libre" }, { reason: "other" }]) {
      assert.equal(deliveryFailSchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });

  it("takes the shown amount as a decimal string only", () => {
    assert.deepEqual(deliveryDeliveredSchema.parse({ amount: "1500" }), { amount: "1500.00" });
    for (const body of [{}, { amount: 1500 }, { amount: "15,00" }, { amount: "-1" }, { amount: "1.234" }, { amount: "100", collectedAmount: "100" }]) {
      assert.equal(deliveryDeliveredSchema.safeParse(body).success, false, JSON.stringify(body));
    }
    assert.equal(deliveryEmptyBodySchema.safeParse({}).success, true);
    assert.equal(deliveryEmptyBodySchema.safeParse({ status: "DELIVERED" }).success, false);
  });
});

describe("delivery management (spec 12, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
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

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  async function product(shop: string, stock = 10): Promise<string> {
    const created = await h.prisma.product.create({
      data: { shopId: shop, name: "Melhfa", description: "Voile léger.", category: "CLOTHING", price: "1500.00", stock, status: "PUBLISHED", publishedAt: new Date() },
    });
    return created.id;
  }

  /** Places an order as checkout does (spec 10): one shop order per shop, with its payment. */
  async function place(lines: { shop: string; productId: string; quantity: number }[]) {
    return h.prisma.$transaction(async (tx) => {
      const shops = [...new Set(lines.map(({ shop }) => shop))];
      const creations = [];
      for (const shop of shops) {
        const row = await tx.shop.findUniqueOrThrow({ where: { id: shop } });
        const items = [];
        for (const line of lines.filter((l) => l.shop === shop)) {
          const p = await tx.product.findUniqueOrThrow({ where: { id: line.productId } });
          items.push({ productId: p.id, variantId: null, productName: p.name, size: null, color: null, imageObjectKey: null, unitPrice: p.price, quantity: line.quantity });
        }
        creations.push({ shopId: shop, shopName: row.shopName, contactPhone: row.contactPhone, whatsappPhone: row.whatsappPhone, deliveryFee: row.deliveryFee ?? new Prisma.Decimal(0), items });
      }
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
        shops: creations,
      });
      // `createOrder` takes the stock (D1); checkout then creates the payments.
      for (const shopOrder of order.shopOrders) {
        await createPayment(tx, { shopOrderId: shopOrder.id, amountDue: shopOrder.total, customerUserId: customer.userId });
      }
      const byShop = new Map(order.shopOrders.map((shopOrder) => [shopOrder.shopId, shopOrder.id]));
      return { orderId: order.id, shopOrderId: (shop: string) => byShop.get(shop) ?? "" };
    });
  }

  /** A confirmed one-shop order of 2 units (amount due 3,000 + 100 fee = 3,100.00). */
  async function confirmedOrder(options: { shop?: string; owner?: Actor; confirm?: boolean } = {}) {
    const shop = options.shop ?? shopId;
    const productId = await product(shop);
    const placed = await place([{ shop, productId, quantity: 2 }]);
    const id = placed.shopOrderId(shop);
    if (options.confirm !== false) assert.equal((await post(`/sellers/me/orders/${id}/confirm`, options.owner ?? seller)).status, 200);
    return { id, orderId: placed.orderId, productId };
  }

  const AMOUNT = "3100.00";
  const path = (id: string, action: string) => `/sellers/me/orders/${id}/delivery/${action}`;
  const stockOf = async (productId: string) => (await h.prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  const row = (id: string) =>
    h.prisma.shopOrder.findUniqueOrThrow({ where: { id }, include: { payment: true, delivery: { include: { attempts: { orderBy: { number: "asc" } } } } } });
  const notificationsOf = (type: string) => h.prisma.notification.findMany({ where: { type }, orderBy: { createdAt: "asc" } });
  const customerShopOrder = async (orderId: string) =>
    ((await (await h.call(`/customers/me/orders/${orderId}`, customer.token)).json()) as CustomerOrder).shopOrders[0];

  /** Every row a delivery transition writes, to prove that a refusal or a repeat changes nothing. */
  async function snapshot() {
    return {
      shopOrders: await h.prisma.shopOrder.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, closedAt: true } }),
      orderEvents: await h.prisma.shopOrderStatusEvent.count(),
      deliveries: await h.prisma.delivery.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, autoCloseAt: true, closedAt: true } }),
      attempts: await h.prisma.deliveryAttempt.findMany({ orderBy: { id: "asc" } }),
      deliveryEvents: await h.prisma.deliveryStatusEvent.count(),
      payments: await h.prisma.payment.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, collectedAmount: true } }),
      paymentEvents: await h.prisma.paymentEvent.count(),
      movements: await h.prisma.stockMovement.count(),
      stock: await h.prisma.product.findMany({ orderBy: { id: "asc" }, select: { id: true, stock: true } }),
      notifications: await h.prisma.notification.count(),
    };
  }

  describe("creation and authorization", () => {
    it("exists only once a shop order is confirmed; never for a pending, rejected, cancelled, or expired one", async () => {
      const pending = await confirmedOrder({ confirm: false });
      const rejected = await confirmedOrder({ confirm: false });
      const cancelled = await confirmedOrder({ confirm: false });
      const expired = await confirmedOrder({ confirm: false });
      await post(`/sellers/me/orders/${rejected.id}/reject`, seller, { reason: "OUT_OF_STOCK" });
      await post(`/customers/me/orders/${cancelled.orderId}/shop-orders/${cancelled.id}/cancel`, customer, {});
      await h.prisma.shopOrder.update({ where: { id: expired.id }, data: { remindAt: new Date(Date.now() - 2000), respondBy: new Date(Date.now() - 1000) } });
      await h.orderLifecycle.expireDue();
      for (const { id } of [pending, rejected, cancelled, expired]) {
        assert.equal((await row(id)).delivery, null);
        const before = await snapshot();
        for (const [action, body] of [
          ["ready", {}],
          ["dispatch", {}],
          ["delivered", { amount: AMOUNT }],
          ["fail", { reason: "OTHER" }],
          ["close", {}],
        ] as const) {
          await expectError(await post(path(id, action), seller, body), 409, "DELIVERY_STATUS_CONFLICT");
        }
        assert.deepEqual(await snapshot(), before);
      }
      const confirmed = await confirmedOrder();
      const delivery = (await row(confirmed.id)).delivery;
      assert.equal(delivery?.status, "PENDING");
      assert.deepEqual(delivery?.attempts, []);
    });

    it("another seller's delivery is 404 and unchanged; customers, pending shops, and anonymous callers are refused", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      const before = await snapshot();
      for (const [action, body] of [
        ["ready", {}],
        ["dispatch", {}],
        ["delivered", { amount: AMOUNT }],
        ["fail", { reason: "OTHER" }],
        ["close", {}],
      ] as const) {
        await expectError(await post(path(id, action), otherSeller, body), 404, "SHOP_ORDER_NOT_FOUND");
        await expectError(await post(path(id, action), customer, body), 403, "FORBIDDEN");
        assert.equal((await h.call(path(id, action), null, { method: "POST", body })).status, 401);
      }
      await expectError(await post(path("not-a-uuid", "dispatch"), seller), 404, "SHOP_ORDER_NOT_FOUND");
      const { owner: pendingOwner } = await h.shopInStatus("PENDING");
      await expectError(await post(path(id, "delivered"), pendingOwner, { amount: AMOUNT }), 403, "FORBIDDEN");
      await expectError(await h.call("/sellers/me/deliveries/in-progress", customer.token), 403, "FORBIDDEN");
      const theirs = (await (await h.call("/sellers/me/deliveries/in-progress", otherSeller.token)).json()) as SellerInProgressDeliveriesResponse;
      assert.deepEqual(theirs.deliveries, []);
      assert.deepEqual(await snapshot(), before);
    });

    it("validates bodies before anything else (400) and changes nothing", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      const before = await snapshot();
      await expectError(await post(path(id, "delivered"), seller, { amount: 3100 }), 400, "BAD_REQUEST");
      await expectError(await post(path(id, "delivered"), seller, {}), 400, "BAD_REQUEST");
      await expectError(await post(path(id, "fail"), seller, {}), 400, "BAD_REQUEST");
      await expectError(await post(path(id, "fail"), seller, { reason: "OTHER", note: "x" }), 400, "BAD_REQUEST");
      await expectError(await post(path(id, "close"), seller, { force: true }), 400, "BAD_REQUEST");
      assert.deepEqual(await snapshot(), before);
    });
  });

  describe("the delivery path", () => {
    it("ready → dispatch → delivered, cash received: delivery, shop order, and payment together", async () => {
      const { id, orderId, productId } = await confirmedOrder();
      const ready = await post(path(id, "ready"), seller);
      assert.equal(ready.status, 200);
      assert.equal(((await ready.json()) as SellerDelivery).record.status, "ASSIGNED");
      assert.equal((await customerShopOrder(orderId))?.label, "READY_FOR_DELIVERY");

      const dispatched = (await (await post(path(id, "dispatch"), seller)).json()) as SellerDelivery;
      assert.equal(dispatched.record.status, "OUT_FOR_DELIVERY");
      assert.equal(dispatched.record.attempts.length, 1);
      assert.deepEqual(dispatched.record.actions, { ready: false, dispatch: false, delivered: true, fail: true, close: false });
      assert.equal(dispatched.payment.amountDue, AMOUNT);
      const out = await customerShopOrder(orderId);
      assert.equal(out?.label, "OUT_FOR_DELIVERY");
      assert.equal(out?.deliveryProgress?.attemptsCount, 1);
      assert.notEqual(out?.deliveryProgress?.currentAttemptDispatchedAt, null);

      const response = await post(path(id, "delivered"), seller, { amount: "3100" });
      assert.equal(response.status, 200);
      const delivered = (await response.json()) as SellerDelivery;
      assert.equal(delivered.record.status, "DELIVERED");
      assert.equal(delivered.shopOrderStatus, "DELIVERED");
      assert.equal(delivered.payment.status, "COLLECTED");
      assert.deepEqual(delivered.record.actions, { ready: false, dispatch: false, delivered: false, fail: false, close: false });

      const stored = await row(id);
      assert.equal(stored.status, "DELIVERED");
      assert.notEqual(stored.closedAt, null);
      assert.equal(stored.delivery?.status, "DELIVERED");
      assert.equal(stored.delivery?.attempts[0]?.outcome, "DELIVERED");
      assert.equal(stored.delivery?.attempts[0]?.outcomeByUserId, seller.userId);
      assert.equal(stored.payment?.status, "COLLECTED");
      assert.equal(stored.payment?.collectedAmount?.toFixed(2), AMOUNT);
      assert.equal(stored.payment?.collectedByUserId, seller.userId);
      assert.equal(await stockOf(productId), 8, "a delivered order keeps its stock taken");
      const collected = await h.prisma.paymentEvent.findMany({ where: { type: "COLLECTED" } });
      assert.equal(collected.length, 1);
      assert.equal(collected[0]?.amount?.toFixed(2), AMOUNT);
      const events = await h.prisma.deliveryStatusEvent.findMany({ where: { delivery: { shopOrderId: id } }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(
        events.map((e) => [e.fromStatus, e.toStatus, e.actorType]),
        [
          [null, "PENDING", "SYSTEM"],
          ["PENDING", "ASSIGNED", "SELLER"],
          ["ASSIGNED", "OUT_FOR_DELIVERY", "SELLER"],
          ["OUT_FOR_DELIVERY", "DELIVERED", "SELLER"],
        ],
      );

      const dispatchedNotice = await notificationsOf("DELIVERY_DISPATCHED");
      assert.equal(dispatchedNotice.length, 1);
      assert.equal(dispatchedNotice[0]?.userId, customer.userId);
      assert.deepEqual(dispatchedNotice[0]?.payload, { orderReference: (await h.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).reference, shopName: "Boutique Alpha", attemptNumber: 1 });
      const completed = await notificationsOf("DELIVERY_COMPLETED");
      assert.equal(completed.length, 1);
      assert.equal(completed[0]?.userId, customer.userId);
      assert.equal((completed[0]?.payload as { amountCollected: string }).amountCollected, AMOUNT);

      const view = await customerShopOrder(orderId);
      assert.equal(view?.label, "DELIVERED");
      assert.equal(view?.payment.status, "COLLECTED");
      assert.equal(view?.deliveryProgress?.currentAttemptDispatchedAt, null);
      assert.notEqual(view?.deliveryProgress?.deliveredAt, null);
    });

    it("ASSIGNED is optional: dispatch works from PENDING", async () => {
      const { id } = await confirmedOrder();
      assert.equal((await post(path(id, "dispatch"), seller)).status, 200);
      assert.equal((await row(id)).delivery?.status, "OUT_FOR_DELIVERY");
    });

    it("repeats return the current state and write nothing; other mismatches are 409", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "ready"), seller);
      let before = await snapshot();
      assert.equal((await post(path(id, "ready"), seller)).status, 200);
      assert.deepEqual(await snapshot(), before);
      await expectError(await post(path(id, "delivered"), seller, { amount: AMOUNT }), 409, "DELIVERY_STATUS_CONFLICT");
      await expectError(await post(path(id, "fail"), seller, { reason: "OTHER" }), 409, "DELIVERY_STATUS_CONFLICT");
      await expectError(await post(path(id, "close"), seller), 409, "DELIVERY_STATUS_CONFLICT");

      await post(path(id, "dispatch"), seller);
      before = await snapshot();
      assert.equal((await post(path(id, "dispatch"), seller)).status, 200);
      assert.deepEqual(await snapshot(), before);
      await expectError(await post(path(id, "ready"), seller), 409, "DELIVERY_STATUS_CONFLICT");
      await expectError(await post(path(id, "close"), seller), 409, "DELIVERY_STATUS_CONFLICT");

      await post(path(id, "delivered"), seller, { amount: AMOUNT });
      before = await snapshot();
      const repeat = await post(path(id, "delivered"), seller, { amount: AMOUNT });
      assert.equal(repeat.status, 200);
      assert.equal(((await repeat.json()) as SellerDelivery).record.status, "DELIVERED");
      assert.deepEqual(await snapshot(), before, "no second collection");
      // No route changes a final delivery.
      for (const [action, body] of [
        ["ready", {}],
        ["dispatch", {}],
        ["fail", { reason: "OTHER" }],
        ["close", {}],
      ] as const) {
        await expectError(await post(path(id, action), seller, body), 409, "DELIVERY_STATUS_CONFLICT");
      }
      assert.deepEqual(await snapshot(), before);
    });

    it("refuses a shown amount different from the amount due (409) and changes nothing", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      const before = await snapshot();
      await expectError(await post(path(id, "delivered"), seller, { amount: "3000.00" }), 409, "PAYMENT_AMOUNT_MISMATCH");
      await expectError(await post(path(id, "delivered"), seller, { amount: "0" }), 409, "PAYMENT_AMOUNT_MISMATCH");
      assert.deepEqual(await snapshot(), before);
      assert.equal((await post(path(id, "delivered"), seller, { amount: "3100.0" })).status, 200);
    });

    it("the delivered action fails as a whole on any error", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      h.faults.delivery.beforeCommit = () => {
        throw new Error("injected");
      };
      const before = await snapshot();
      assert.equal((await post(path(id, "delivered"), seller, { amount: AMOUNT })).status, 500);
      assert.equal((await post(path(id, "fail"), seller, { reason: "OTHER" })).status, 500);
      assert.deepEqual(await snapshot(), before);
      const stored = await row(id);
      assert.equal(stored.status, "CONFIRMED");
      assert.equal(stored.payment?.status, "PENDING");
    });

    it("a delivered action racing a failure: exactly one wins, and the cash is collected at most once", async () => {
      for (let round = 0; round < 5; round += 1) {
        const { id } = await confirmedOrder();
        await post(path(id, "dispatch"), seller);
        const [delivered, failed] = await Promise.all([post(path(id, "delivered"), seller, { amount: AMOUNT }), post(path(id, "fail"), seller, { reason: "CUSTOMER_ABSENT" })]);
        assert.deepEqual([delivered.status, failed.status].sort(), [200, 409]);
        const stored = await row(id);
        assert.equal(stored.delivery?.attempts.length, 1);
        assert.equal(stored.payment?.status, delivered.status === 200 ? "COLLECTED" : "PENDING");
      }
    });
  });

  describe("failure, retry, and closure (D5)", () => {
    it("records failures with a reason and a deadline, retries with no limit, and never overwrites history", async () => {
      const { id, orderId } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      const failedAt = Date.now();
      const failed = (await (await post(path(id, "fail"), seller, { reason: "CUSTOMER_UNREACHABLE" })).json()) as SellerDelivery;
      assert.equal(failed.record.status, "FAILED");
      assert.deepEqual(failed.record.actions, { ready: false, dispatch: true, delivered: false, fail: false, close: true });
      const deadline = Date.parse(failed.record.autoCloseAt ?? "");
      assert.ok(Math.abs(deadline - (failedAt + DELIVERY_FAILED_AUTO_CLOSE_DAYS * DAY)) < 60_000, "deadline = failure + configured days");
      assert.equal(failed.shopOrderStatus, "CONFIRMED");
      assert.equal(failed.payment.status, "PENDING", "the payment stays pending while a retry is possible");
      let view = await customerShopOrder(orderId);
      assert.equal(view?.label, "DELIVERY_FAILED_RETRY");
      assert.deepEqual(
        view?.deliveryProgress?.failures.map((f) => [f.attemptNumber, f.reason]),
        [[1, "CUSTOMER_UNREACHABLE"]],
      );

      // Same failure again: a repeat. A different reason: a conflict.
      const before = await snapshot();
      assert.equal((await post(path(id, "fail"), seller, { reason: "CUSTOMER_UNREACHABLE" })).status, 200);
      await expectError(await post(path(id, "fail"), seller, { reason: "OTHER" }), 409, "DELIVERY_STATUS_CONFLICT");
      await expectError(await post(path(id, "delivered"), seller, { amount: AMOUNT }), 409, "DELIVERY_STATUS_CONFLICT");
      assert.deepEqual(await snapshot(), before);

      // Retry: a new attempt clears the deadline.
      const retried = (await (await post(path(id, "dispatch"), seller)).json()) as SellerDelivery;
      assert.equal(retried.record.autoCloseAt, null);
      await post(path(id, "fail"), seller, { reason: "CUSTOMER_COULD_NOT_PAY" });
      await post(path(id, "dispatch"), seller);
      await post(path(id, "fail"), seller, { reason: "ADDRESS_NOT_FOUND" });
      await post(path(id, "dispatch"), seller);
      assert.equal((await post(path(id, "delivered"), seller, { amount: AMOUNT })).status, 200);

      const attempts = (await row(id)).delivery?.attempts ?? [];
      assert.deepEqual(
        attempts.map((a) => [a.number, a.outcome, a.failureReason]),
        [
          [1, "FAILED", "CUSTOMER_UNREACHABLE"],
          [2, "FAILED", "CUSTOMER_COULD_NOT_PAY"],
          [3, "FAILED", "ADDRESS_NOT_FOUND"],
          [4, "DELIVERED", null],
        ],
      );
      view = await customerShopOrder(orderId);
      assert.equal(view?.deliveryProgress?.attemptsCount, 4);
      assert.equal(view?.deliveryProgress?.failures.length, 3);
      assert.equal(view?.label, "DELIVERED");
      assert.equal((await notificationsOf("DELIVERY_DISPATCHED")).length, 4);
      const failures = await notificationsOf("DELIVERY_ATTEMPT_FAILED");
      assert.deepEqual(
        failures.map((n) => (n.payload as { reasonCode: string }).reasonCode),
        ["CUSTOMER_UNREACHABLE", "CUSTOMER_COULD_NOT_PAY", "ADDRESS_NOT_FOUND"],
      );
    });

    it("the database keeps one open attempt per delivery and a reason exactly on failures", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      const delivery = (await row(id)).delivery;
      assert.ok(delivery);
      await assert.rejects(h.prisma.deliveryAttempt.create({ data: { deliveryId: delivery.id, number: 2, dispatchedAt: new Date(), dispatchedByUserId: seller.userId } }));
      await assert.rejects(h.prisma.deliveryAttempt.update({ where: { id: delivery.attempts[0]?.id ?? "" }, data: { failureReason: "OTHER" } }));
      await assert.rejects(
        h.prisma.deliveryAttempt.update({ where: { id: delivery.attempts[0]?.id ?? "" }, data: { outcome: "FAILED", outcomeAt: new Date(), outcomeByUserId: seller.userId } }),
      );
    });

    it("closing a failure ends the shop order as FAILED_DELIVERY: stock returned once, payment FAILED, customer told", async () => {
      const { id, orderId, productId } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      await post(path(id, "fail"), seller, { reason: "CUSTOMER_REFUSED" });
      assert.equal(await stockOf(productId), 8);
      const response = await post(path(id, "close"), seller);
      assert.equal(response.status, 200);
      const closed = (await response.json()) as SellerDelivery;
      assert.equal(closed.record.status, "FAILED");
      assert.notEqual(closed.record.closedAt, null);
      assert.equal(closed.shopOrderStatus, "FAILED_DELIVERY");
      assert.equal(closed.payment.status, "FAILED");
      assert.deepEqual(closed.record.actions, { ready: false, dispatch: false, delivered: false, fail: false, close: false });
      assert.equal(await stockOf(productId), 10);
      assert.equal((await notificationsOf("DELIVERY_CLOSED_UNDELIVERABLE")).length, 1);
      assert.equal((await customerShopOrder(orderId))?.label, "UNDELIVERABLE");

      const before = await snapshot();
      assert.equal((await post(path(id, "close"), seller)).status, 200, "a repeat");
      await expectError(await post(path(id, "dispatch"), seller), 409, "DELIVERY_STATUS_CONFLICT");
      assert.equal(await closeDueDeliveries(h.prisma).then((r) => r.done), 0);
      assert.deepEqual(await snapshot(), before);
      assert.equal(await stockOf(productId), 10, "returned exactly once");
    });

    it("the closure job closes only failures past their deadline, as the system, once", async () => {
      const due = await confirmedOrder();
      const notDue = await confirmedOrder();
      const out = await confirmedOrder();
      for (const { id } of [due, notDue, out]) await post(path(id, "dispatch"), seller);
      for (const { id } of [due, notDue]) await post(path(id, "fail"), seller, { reason: "CUSTOMER_ABSENT" });
      await h.prisma.delivery.update({ where: { shopOrderId: due.id }, data: { autoCloseAt: new Date(Date.now() - 1000) } });

      assert.deepEqual(await h.deliveryLifecycle.closeDue(), { done: 1, failed: 0 });
      const closed = await row(due.id);
      assert.equal(closed.status, "FAILED_DELIVERY");
      assert.notEqual(closed.delivery?.closedAt, null);
      assert.equal(closed.payment?.status, "FAILED");
      assert.equal(await stockOf(due.productId), 10);
      const event = await h.prisma.deliveryStatusEvent.findFirst({ where: { deliveryId: closed.delivery?.id ?? "", fromStatus: "FAILED", toStatus: "FAILED" } });
      assert.equal(event?.actorType, "SYSTEM");
      assert.equal((await h.prisma.shopOrderStatusEvent.findFirst({ where: { shopOrderId: due.id, toStatus: "FAILED_DELIVERY" } }))?.actorType, "SYSTEM");
      assert.equal((await row(notDue.id)).delivery?.closedAt, null);
      assert.equal((await row(out.id)).delivery?.status, "OUT_FOR_DELIVERY");

      const before = await snapshot();
      assert.deepEqual(await closeDueDeliveries(h.prisma), { done: 0, failed: 0 });
      assert.deepEqual(await snapshot(), before);
    });

    it("concurrent job runs and a racing seller closure close each failure exactly once", async () => {
      const orders = [await confirmedOrder(), await confirmedOrder(), await confirmedOrder()];
      for (const { id } of orders) {
        await post(path(id, "dispatch"), seller);
        await post(path(id, "fail"), seller, { reason: "OTHER" });
        await h.prisma.delivery.update({ where: { shopOrderId: id }, data: { autoCloseAt: new Date(Date.now() - 1000) } });
      }
      const [first, second, sellerClose] = await Promise.all([closeDueDeliveries(h.prisma), closeDueDeliveries(h.prisma), post(path(orders[0]?.id ?? "", "close"), seller)]);
      assert.equal(sellerClose.status, 200);
      const sellerClosed = (await h.prisma.deliveryStatusEvent.count({ where: { fromStatus: "FAILED", toStatus: "FAILED", actorType: "SELLER" } })) === 1 ? 1 : 0;
      assert.equal(first.done + second.done + sellerClosed, 3);
      for (const { id, productId } of orders) {
        assert.equal((await row(id)).status, "FAILED_DELIVERY");
        assert.equal(await stockOf(productId), 10);
        assert.equal(await h.prisma.stockMovement.count({ where: { orderItem: { shopOrderId: id }, type: "RETURNED" } }), 1);
      }
      assert.equal(await h.prisma.deliveryStatusEvent.count({ where: { fromStatus: "FAILED", toStatus: "FAILED" } }), 3);
      assert.equal((await notificationsOf("DELIVERY_CLOSED_UNDELIVERABLE")).length, 3);
    });

    it("a failing closure in the job is counted, rolled back, and retried by the next run", async () => {
      const { id } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      await post(path(id, "fail"), seller, { reason: "OTHER" });
      await h.prisma.delivery.update({ where: { shopOrderId: id }, data: { autoCloseAt: new Date(Date.now() - 1000) } });
      h.faults.delivery.beforeCommit = () => {
        throw new Error("injected");
      };
      const before = await snapshot();
      assert.deepEqual(await h.deliveryLifecycle.closeDue(), { done: 0, failed: 1 });
      assert.deepEqual(await snapshot(), before);
      delete h.faults.delivery.beforeCommit;
      assert.deepEqual(await h.deliveryLifecycle.closeDue(), { done: 1, failed: 0 });
    });

    it("the closure job has its own advisory lock", async (t) => {
      if (databaseUrl === undefined) return t.skip();
      const first = createAdvisoryLock(databaseUrl, () => undefined, DELIVERY_AUTO_CLOSE_LOCK_NAME);
      const second = createAdvisoryLock(databaseUrl, () => undefined, DELIVERY_AUTO_CLOSE_LOCK_NAME);
      try {
        assert.equal(await first.tryAcquire(), true);
        assert.equal(await second.tryAcquire(), false);
      } finally {
        await first.release();
        await second.release();
      }
    });
  });

  describe("cancellation and dispatch", () => {
    it("a cancelled shop order cancels a delivery not yet out; once out, nobody can cancel", async () => {
      const notOut = await confirmedOrder();
      await post(path(notOut.id, "ready"), seller);
      assert.equal((await post(`/sellers/me/orders/${notOut.id}/cancel`, seller, { reason: "OUT_OF_STOCK" })).status, 200);
      assert.equal((await row(notOut.id)).delivery?.status, "CANCELLED");
      await expectError(await post(path(notOut.id, "dispatch"), seller), 409, "DELIVERY_STATUS_CONFLICT");

      const out = await confirmedOrder();
      await post(path(out.id, "dispatch"), seller);
      await expectError(await post(`/sellers/me/orders/${out.id}/cancel`, seller, { reason: "OTHER" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
      await expectError(await post(`/admin/orders/${out.id}/cancel`, admin, { internalReason: "Annulation demandée par le support" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
      assert.equal((await row(out.id)).delivery?.status, "OUT_FOR_DELIVERY");
    });
  });

  describe("suspended shops (D8)", () => {
    it("the owner can only finish deliveries already under way, cannot retry, and is 403 for everything else", async () => {
      const pending = await confirmedOrder();
      const outA = await confirmedOrder();
      const outB = await confirmedOrder();
      const failed = await confirmedOrder();
      const delivered = await confirmedOrder();
      for (const { id } of [outA, outB, failed, delivered]) await post(path(id, "dispatch"), seller);
      await post(path(failed.id, "fail"), seller, { reason: "CUSTOMER_ABSENT" });
      await post(path(delivered.id, "delivered"), seller, { amount: AMOUNT });

      assert.equal((await post(`/admin/shops/${shopId}/suspend`, admin, { internalReason: "Suspension pour contrôle qualité" })).status, 200);
      assert.equal((await row(pending.id)).delivery?.status, "CANCELLED", "cancelled by the suspension itself");

      // Only the deliveries under way, with the full snapshot and no retry.
      const list = (await (await h.call("/sellers/me/deliveries/in-progress", seller.token)).json()) as SellerInProgressDeliveriesResponse;
      assert.deepEqual(list.deliveries.map((d) => d.shopOrderId).sort(), [outA.id, outB.id, failed.id].sort());
      const failedItem = list.deliveries.find((d) => d.shopOrderId === failed.id);
      assert.deepEqual(failedItem?.record.actions, { ready: false, dispatch: false, delivered: false, fail: false, close: true });
      assert.equal(failedItem?.delivery.recipientName, "Aïcha Mint Ahmed");
      assert.equal(failedItem?.delivery.deliveryPhone, "+22233000000");
      assert.deepEqual(list.deliveries.find((d) => d.shopOrderId === outA.id)?.record.actions, { ready: false, dispatch: false, delivered: true, fail: true, close: false });

      // Everything else stays 403.
      const before = await snapshot();
      await expectError(await post(path(failed.id, "dispatch"), seller), 403, "FORBIDDEN");
      await expectError(await post(path(pending.id, "ready"), seller), 403, "FORBIDDEN");
      await expectError(await post(path(delivered.id, "delivered"), seller, { amount: AMOUNT }), 403, "FORBIDDEN");
      await expectError(await post(path(pending.id, "close"), seller), 403, "FORBIDDEN");
      await expectError(await h.call("/sellers/me/orders", seller.token), 403, "FORBIDDEN");
      await expectError(await h.call(`/sellers/me/orders/${outA.id}`, seller.token), 403, "FORBIDDEN");
      await expectError(await post(`/sellers/me/orders/${outA.id}/cancel`, seller, { reason: "OTHER" }), 403, "FORBIDDEN");
      assert.deepEqual(await snapshot(), before);

      // The three allowed operations.
      assert.equal((await post(path(outA.id, "delivered"), seller, { amount: AMOUNT })).status, 200);
      assert.equal((await row(outA.id)).payment?.status, "COLLECTED");
      assert.equal((await post(path(outB.id, "fail"), seller, { reason: "CUSTOMER_UNREACHABLE" })).status, 200);
      await expectError(await post(path(outB.id, "dispatch"), seller), 403, "FORBIDDEN");
      assert.equal((await post(path(failed.id, "close"), seller)).status, 200);
      assert.equal((await row(failed.id)).status, "FAILED_DELIVERY");

      // A finished delivery is gone from the list, and no longer reachable.
      await expectError(await post(path(outA.id, "fail"), seller, { reason: "OTHER" }), 403, "FORBIDDEN");
      const after = (await (await h.call("/sellers/me/deliveries/in-progress", seller.token)).json()) as SellerInProgressDeliveriesResponse;
      assert.deepEqual(
        after.deliveries.map((d) => d.shopOrderId),
        [outB.id],
      );

      // The job still closes a suspended shop's failure.
      await h.prisma.delivery.update({ where: { shopOrderId: outB.id }, data: { autoCloseAt: new Date(Date.now() - 1000) } });
      assert.deepEqual(await closeDueDeliveries(h.prisma), { done: 1, failed: 0 });
      assert.equal((await row(outB.id)).status, "FAILED_DELIVERY");
    });
  });

  describe("views and snapshots", () => {
    it("the customer sees progress without seller-only data; the seller and admin see the record", async () => {
      const { id, orderId } = await confirmedOrder();
      await post(path(id, "dispatch"), seller);
      await post(path(id, "fail"), seller, { reason: "CUSTOMER_ABSENT" });

      const raw = JSON.stringify(await (await h.call(`/customers/me/orders/${orderId}`, customer.token)).json());
      for (const hidden of [seller.userId, "autoCloseAt", "dispatchedByUserId", "outcomeByUserId", "actorUserId", "collectedByUserId"]) {
        assert.equal(raw.includes(hidden), false, hidden);
      }
      const progress = (await customerShopOrder(orderId))?.deliveryProgress;
      assert.deepEqual(Object.keys(progress ?? {}).sort(), ["attemptsCount", "currentAttemptDispatchedAt", "deliveredAt", "failures"]);

      const sellerView = (await (await h.call(`/sellers/me/orders/${id}`, seller.token)).json()) as SellerShopOrderDetail;
      assert.equal(sellerView.deliveryRecord?.status, "FAILED");
      assert.equal(sellerView.deliveryRecord?.attempts[0]?.failureReason, "CUSTOMER_ABSENT");
      assert.notEqual(sellerView.deliveryRecord?.autoCloseAt, null);
      assert.equal(sellerView.deliveryRecord?.actions.dispatch, true);

      const adminView = (await (await h.call(`/admin/orders/${id}`, admin.token)).json()) as AdminShopOrderDetail;
      assert.equal(adminView.deliveryRecord?.attempts[0]?.dispatchedByUserId, seller.userId);
      assert.equal(adminView.deliveryRecord?.attempts[0]?.outcomeByUserId, seller.userId);
      assert.notEqual(adminView.deliveryRecord?.autoCloseAt, null);

      const pending = await confirmedOrder({ confirm: false });
      const before = (await (await h.call(`/sellers/me/orders/${pending.id}`, seller.token)).json()) as SellerShopOrderDetail;
      assert.equal(before.deliveryRecord, null);
      assert.equal((await customerShopOrder(pending.orderId))?.deliveryProgress, null);
    });

    it("uses the shop order's snapshots: later shop fee and phone edits change nothing", async () => {
      const { id } = await confirmedOrder();
      await h.prisma.shop.update({ where: { id: shopId }, data: { deliveryFee: "999.00" } });
      const view = (await (await post(path(id, "dispatch"), seller)).json()) as SellerDelivery;
      assert.equal(view.deliveryFee, "100.00");
      assert.equal(view.payment.amountDue, AMOUNT);
      assert.equal(view.delivery.landmark, "Près de la mosquée bleue");
      assert.equal(view.delivery.latitude, 18.086);
      // No route changes a fee or the snapshot.
      assert.equal((await h.call(`/sellers/me/orders/${id}/delivery`, seller.token, { method: "PATCH", body: { deliveryFee: "0" } })).status, 404);
      assert.equal((await post(path(id, "delivered"), seller, { amount: AMOUNT })).status, 200);
      assert.equal((await row(id)).deliveryFee.toFixed(2), "100.00");
    });

    it("keeps the deliveries of a multi-shop order independent", async () => {
      const a = await product(shopId);
      const b = await product(otherShopId);
      const placed = await place([
        { shop: shopId, productId: a, quantity: 1 },
        { shop: otherShopId, productId: b, quantity: 1 },
      ]);
      const mine = placed.shopOrderId(shopId);
      const theirs = placed.shopOrderId(otherShopId);
      await post(`/sellers/me/orders/${mine}/confirm`, seller);
      await post(`/sellers/me/orders/${theirs}/confirm`, otherSeller);
      await post(path(mine, "dispatch"), seller);
      await post(path(mine, "fail"), seller, { reason: "OTHER" });
      await post(path(mine, "close"), seller);
      assert.equal((await row(mine)).status, "FAILED_DELIVERY");
      const other = await row(theirs);
      assert.equal(other.status, "CONFIRMED");
      assert.equal(other.delivery?.status, "PENDING");
      assert.equal(other.payment?.status, "PENDING");
      await post(path(theirs, "dispatch"), otherSeller);
      assert.equal((await post(path(theirs, "delivered"), otherSeller, { amount: "1550.00" })).status, 200);
      const view = (await (await h.call(`/customers/me/orders/${placed.orderId}`, customer.token)).json()) as CustomerOrder;
      assert.deepEqual(view.shopOrders.map((s) => s.label).sort(), ["DELIVERED", "UNDELIVERABLE"]);
    });

    it("rate-limits delivery writes with the order write limit", async () => {
      const { id } = await confirmedOrder();
      h.orderRateLimiter = { hit: async () => ({ allowed: false, retryAfterSeconds: 60 }) };
      assert.equal((await post(path(id, "dispatch"), seller)).status, 429);
      assert.equal((await row(id)).delivery?.status, "PENDING");
    });
  });
});
