import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  adminOrderCancellationSchema,
  adminOrderListQuerySchema,
  customerCancellationSchema,
  sellerCancellationSchema,
  sellerConfirmationSchema,
  sellerRejectionSchema,
  shopOrderLabel,
  type AdminShopOrderDetail,
  type AdminShopOrderListResponse,
  type CustomerOrder,
  type CustomerOrderListResponse,
  type SellerShopOrderDetail,
  type SellerShopOrderListResponse,
} from "@chicman/shared";
import dotenv from "dotenv";

import { Prisma } from "../src/generated/prisma/client.js";
import { returnOrderStock } from "../src/modules/inventory/index.js";
import { recordShopOrderPlaced } from "../src/modules/notifications/index.js";
import { createOrder, markShopOrderDelivered, markShopOrderFailedDelivery } from "../src/modules/orders/index.js";
import { createPayment } from "../src/modules/payments/index.js";
import { createAdvisoryLock, ORDER_EXPIRY_LOCK_NAME, ORDER_REMINDER_LOCK_NAME } from "../src/workers/advisory-lock.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("order lifecycle contract (spec 11)", () => {
  it("accepts an empty customer cancellation and requires the text exactly with OTHER", () => {
    assert.equal(customerCancellationSchema.safeParse({}).success, true);
    assert.equal(customerCancellationSchema.safeParse({ reason: "CHANGED_MIND" }).success, true);
    assert.deepEqual(customerCancellationSchema.parse({ reason: "OTHER", reasonText: "  Trop  long délai " }), { reason: "OTHER", reasonText: "Trop  long délai" });
    for (const body of [
      { reason: "OTHER" },
      { reason: "CHANGED_MIND", reasonText: "Pas besoin" },
      { reasonText: "Pas besoin" },
      { reason: "OTHER", reasonText: "ab" },
      { reason: "OTHER", reasonText: "x".repeat(201) },
      { reason: "OTHER", reasonText: "Bonjour\u0007" },
      { reason: "OUT_OF_STOCK" },
      { reason: "CHANGED_MIND", status: "CANCELLED" },
    ]) {
      assert.equal(customerCancellationSchema.safeParse(body).success, false, JSON.stringify(body));
    }
    assert.equal(customerCancellationSchema.safeParse({ reason: "OTHER", reasonText: "x".repeat(200) }).success, true);
  });

  it("requires a seller reason from the fixed lists; cancellation adds CUSTOMER_REQUESTED", () => {
    for (const reason of ["OUT_OF_STOCK", "CANNOT_DELIVER_TO_AREA", "PRICE_ERROR", "OTHER"]) {
      assert.equal(sellerRejectionSchema.safeParse({ reason }).success, true);
      assert.equal(sellerCancellationSchema.safeParse({ reason }).success, true);
    }
    assert.equal(sellerRejectionSchema.safeParse({ reason: "CUSTOMER_REQUESTED" }).success, false);
    assert.equal(sellerCancellationSchema.safeParse({ reason: "CUSTOMER_REQUESTED" }).success, true);
    for (const body of [{}, { reason: "nope" }, { reason: "OTHER", reasonText: "free text" }]) {
      assert.equal(sellerRejectionSchema.safeParse(body).success, false);
      assert.equal(sellerCancellationSchema.safeParse(body).success, false);
    }
    assert.equal(sellerConfirmationSchema.safeParse({}).success, true);
    assert.equal(sellerConfirmationSchema.safeParse({ status: "CONFIRMED" }).success, false);
  });

  it("requires a 10–500 character internal reason and an optional 1–1000 character note for administrators", () => {
    assert.equal(adminOrderCancellationSchema.safeParse({ internalReason: "Fraude signalée par le client" }).success, true);
    assert.equal(adminOrderCancellationSchema.safeParse({ internalReason: "court" }).success, false);
    assert.equal(adminOrderCancellationSchema.safeParse({ internalReason: "x".repeat(501) }).success, false);
    assert.equal(adminOrderCancellationSchema.safeParse({ internalReason: "Raison valable ici", internalNote: "x".repeat(1001) }).success, false);
    assert.equal(adminOrderCancellationSchema.safeParse({ internalReason: "Raison valable ici", reason: "OTHER" }).success, false);
  });

  it("refuses an inverted date range in the admin list", () => {
    assert.equal(adminOrderListQuerySchema.safeParse({ from: "2026-11-09", to: "2026-11-01" }).success, false);
    assert.equal(adminOrderListQuerySchema.safeParse({ from: "2026-11-01", to: "2026-11-09" }).success, true);
  });

  it("derives one label per shop order from the order and delivery statuses", () => {
    assert.equal(shopOrderLabel("PENDING"), "AWAITING_SHOP");
    assert.equal(shopOrderLabel("CONFIRMED", "PENDING"), "PREPARING");
    assert.equal(shopOrderLabel("CONFIRMED", "ASSIGNED"), "READY_FOR_DELIVERY");
    assert.equal(shopOrderLabel("CONFIRMED", "OUT_FOR_DELIVERY"), "OUT_FOR_DELIVERY");
    assert.equal(shopOrderLabel("CONFIRMED", "FAILED"), "DELIVERY_FAILED_RETRY");
    assert.equal(shopOrderLabel("FAILED_DELIVERY"), "UNDELIVERABLE");
    assert.equal(shopOrderLabel("EXPIRED"), "EXPIRED");
  });
});

describe("order management (spec 11, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let otherSeller: Actor;
  let otherShopId: string;
  let customer: Actor;
  let admin: Actor;

  const INTERNAL_REASON = "Fraude signalée par téléphone, référence interne 77";
  const INTERNAL_NOTE = "Note interne très confidentielle";
  const CUSTOMER_TEXT = "Le délai de livraison est trop long";

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: shopId }, data: { shopName: "Boutique Alpha", deliveryFee: "100.00", whatsappPhone: "+22246000001" } });
    ({ owner: otherSeller, shopId: otherShopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: otherShopId }, data: { shopName: "Boutique Beta", deliveryFee: "50.00", contactPhone: "+22237000000" } });
    customer = await h.actor();
    admin = await h.actor(["CUSTOMER", "ADMIN"]);
  });

  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", ...(body === undefined ? {} : { body }) });

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  interface ProductSpec {
    shop?: string;
    name?: string;
    price?: string;
    stock?: number;
    variants?: { size: string; stock: number }[];
  }

  async function product(spec: ProductSpec = {}): Promise<{ id: string; variantIds: string[] }> {
    const created = await h.prisma.product.create({
      data: {
        shopId: spec.shop ?? shopId,
        name: spec.name ?? "Melhfa",
        description: "Voile léger.",
        category: "CLOTHING",
        price: spec.price ?? "1500.00",
        stock: spec.stock ?? 10,
        status: "PUBLISHED",
        publishedAt: new Date(),
        variants: { create: spec.variants ?? [] },
      },
      include: { variants: { orderBy: { size: "asc" } } },
    });
    return { id: created.id, variantIds: created.variants.map(({ id }) => id) };
  }

  interface Line {
    productId: string;
    variantId?: string;
    quantity: number;
  }

  /** Places an order as checkout does (spec 10): order, stock, payments, seller notifications, in one transaction. */
  async function place(shops: { shop: string; lines: Line[] }[], options: { actor?: Actor; placedAt?: Date } = {}) {
    const actor = options.actor ?? customer;
    return h.prisma.$transaction(async (tx) => {
      const creations = [];
      for (const { shop, lines } of shops) {
        const row = await tx.shop.findUniqueOrThrow({ where: { id: shop } });
        const items = [];
        for (const line of lines) {
          const p = await tx.product.findUniqueOrThrow({ where: { id: line.productId }, include: { variants: true } });
          const variant = p.variants.find(({ id }) => id === line.variantId) ?? null;
          items.push({
            productId: p.id,
            variantId: variant?.id ?? null,
            productName: p.name,
            size: variant?.size ?? null,
            color: variant?.color ?? null,
            imageObjectKey: `product-images/${shop}/${p.id}/image.webp`,
            unitPrice: p.price,
            quantity: line.quantity,
          });
        }
        creations.push({
          shopId: shop,
          shopName: row.shopName,
          contactPhone: row.contactPhone,
          whatsappPhone: row.whatsappPhone,
          deliveryFee: row.deliveryFee ?? new Prisma.Decimal(0),
          items,
        });
      }
      const order = await createOrder(tx, {
        customerUserId: actor.userId,
        idempotencyKey: randomUUID(),
        placedAt: options.placedAt ?? new Date(),
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
      for (const shopOrder of order.shopOrders) {
        await createPayment(tx, { shopOrderId: shopOrder.id, amountDue: shopOrder.total, customerUserId: actor.userId });
        const owner = await tx.shop.findUniqueOrThrow({ where: { id: shopOrder.shopId }, select: { ownerUserId: true } });
        await recordShopOrderPlaced(tx, {
          sellerUserId: owner.ownerUserId,
          orderReference: order.reference,
          shopOrderId: shopOrder.id,
          itemsCount: shopOrder.itemsCount,
          total: shopOrder.total,
          respondBy: shopOrder.respondBy,
        });
      }
      const byShop = new Map(order.shopOrders.map((shopOrder) => [shopOrder.shopId, shopOrder.id]));
      return { orderId: order.id, reference: order.reference, shopOrderId: (shop: string) => byShop.get(shop) ?? "" };
    });
  }

  /** A one-shop order of `quantity` units of a fresh product; returns its IDs. */
  async function simpleOrder(options: { quantity?: number; placedAt?: Date; shop?: string; stock?: number } = {}) {
    const shop = options.shop ?? shopId;
    const p = await product({ shop, stock: options.stock ?? 10 });
    const placed = await place([{ shop, lines: [{ productId: p.id, quantity: options.quantity ?? 2 }] }], options.placedAt === undefined ? {} : { placedAt: options.placedAt });
    return { ...placed, productId: p.id, id: placed.shopOrderId(shop) };
  }

  const HOUR = 3_600_000;
  const pastDeadline = () => new Date(Date.now() - 49 * HOUR);

  const sellerPath = (id: string) => `/sellers/me/orders/${id}`;
  const customerCancelPath = (orderId: string, id: string) => `/customers/me/orders/${orderId}/shop-orders/${id}/cancel`;
  const adminPath = (id: string) => `/admin/orders/${id}`;

  const stockOf = async (productId: string) => (await h.prisma.product.findUniqueOrThrow({ where: { id: productId } })).stock;
  const shopOrderRow = (id: string) => h.prisma.shopOrder.findUniqueOrThrow({ where: { id }, include: { payment: true, delivery: true } });
  const notificationsOf = (type: string) => h.prisma.notification.findMany({ where: { type }, orderBy: { userId: "asc" } });

  /** Every row a transition writes, to prove that a refusal changes nothing. */
  async function snapshot() {
    return {
      shopOrders: await h.prisma.shopOrder.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, closedAt: true, reasonCode: true } }),
      events: await h.prisma.shopOrderStatusEvent.count(),
      movements: await h.prisma.stockMovement.count(),
      payments: await h.prisma.payment.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true } }),
      paymentEvents: await h.prisma.paymentEvent.count(),
      deliveries: await h.prisma.delivery.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true } }),
      deliveryEvents: await h.prisma.deliveryStatusEvent.count(),
      notifications: await h.prisma.notification.count(),
      stock: await h.prisma.product.findMany({ orderBy: { id: "asc" }, select: { id: true, stock: true } }),
      variantStock: await h.prisma.productVariant.findMany({ orderBy: { id: "asc" }, select: { id: true, stock: true } }),
    };
  }

  describe("authorization and isolation", () => {
    it("requires a token and a bootstrapped user on every route", async () => {
      const { orderId, id } = await simpleOrder();
      for (const [path, method] of [
        ["/customers/me/orders", "GET"],
        [`/customers/me/orders/${orderId}`, "GET"],
        [customerCancelPath(orderId, id), "POST"],
        ["/sellers/me/orders", "GET"],
        [`${sellerPath(id)}/confirm`, "POST"],
        ["/admin/orders", "GET"],
        [`${adminPath(id)}/cancel`, "POST"],
      ] as const) {
        assert.equal((await h.call(path, null, { method })).status, 401, path);
      }
    });

    it("shows customers only their own orders: another's is 404, never disclosed", async () => {
      const { orderId, id } = await simpleOrder();
      const other = await h.actor();
      await expectError(await h.call(`/customers/me/orders/${orderId}`, other.token), 404, "ORDER_NOT_FOUND");
      await expectError(await h.call("/customers/me/orders/not-a-uuid", other.token), 404, "ORDER_NOT_FOUND");
      const list = (await (await h.call("/customers/me/orders", other.token)).json()) as CustomerOrderListResponse;
      assert.equal(list.total, 0);
      const before = await snapshot();
      await expectError(await post(customerCancelPath(orderId, id), other, {}), 404, "ORDER_NOT_FOUND");
      assert.deepEqual(await snapshot(), before);
    });

    it("refuses a shop order that is not part of the named order (404)", async () => {
      const first = await simpleOrder();
      const second = await simpleOrder();
      await expectError(await post(customerCancelPath(first.orderId, second.id), customer, {}), 404, "SHOP_ORDER_NOT_FOUND");
      assert.equal((await shopOrderRow(second.id)).status, "PENDING");
    });

    it("shows sellers only their own shop orders: another shop's is 404 and unchanged", async () => {
      const mine = await simpleOrder();
      const theirs = await simpleOrder({ shop: otherShopId });
      const list = (await (await h.call("/sellers/me/orders", seller.token)).json()) as SellerShopOrderListResponse;
      assert.deepEqual(
        list.shopOrders.map(({ id }) => id),
        [mine.id],
      );
      await expectError(await h.call(sellerPath(theirs.id), seller.token), 404, "SHOP_ORDER_NOT_FOUND");
      const before = await snapshot();
      await expectError(await post(`${sellerPath(theirs.id)}/confirm`, seller), 404, "SHOP_ORDER_NOT_FOUND");
      await expectError(await post(`${sellerPath(theirs.id)}/reject`, seller, { reason: "OTHER" }), 404, "SHOP_ORDER_NOT_FOUND");
      await expectError(await post(`${sellerPath(theirs.id)}/cancel`, seller, { reason: "OTHER" }), 404, "SHOP_ORDER_NOT_FOUND");
      assert.deepEqual(await snapshot(), before);
    });

    it("denies seller routes without an approved shop, and admin routes without ADMIN", async () => {
      const { id } = await simpleOrder();
      await expectError(await h.call("/sellers/me/orders", customer.token), 403, "FORBIDDEN");
      await expectError(await post(`${sellerPath(id)}/confirm`, customer), 403, "FORBIDDEN");
      await expectError(await h.call("/admin/orders", seller.token), 403, "FORBIDDEN");
      await expectError(await post(`${adminPath(id)}/cancel`, seller, { internalReason: INTERNAL_REASON }), 403, "FORBIDDEN");
      const { owner: pendingOwner } = await h.shopInStatus("PENDING");
      await expectError(await h.call("/sellers/me/orders", pendingOwner.token), 403, "FORBIDDEN");
    });

    it("a suspended owner gets 403 on every seller order route", async () => {
      const { id } = await simpleOrder();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      for (const path of ["/sellers/me/orders", sellerPath(id)]) await expectError(await h.call(path, seller.token), 403, "FORBIDDEN");
      for (const [action, body] of [
        ["confirm", {}],
        ["reject", { reason: "OTHER" }],
        ["cancel", { reason: "OTHER" }],
      ] as const) {
        await expectError(await post(`${sellerPath(id)}/${action}`, seller, body), 403, "FORBIDDEN");
      }
      assert.equal((await shopOrderRow(id)).status, "PENDING");
    });

    it("rate-limits seller and customer order writes", async () => {
      const { orderId, id } = await simpleOrder();
      h.orderRateLimiter = { hit: async () => ({ allowed: false, retryAfterSeconds: 60 }) };
      assert.equal((await post(`${sellerPath(id)}/confirm`, seller)).status, 429);
      assert.equal((await post(customerCancelPath(orderId, id), customer, {})).status, 429);
      assert.equal((await shopOrderRow(id)).status, "PENDING");
    });
  });

  describe("placement records", () => {
    it("one shop gives one shop order; several shops give one order with independent shop orders", async () => {
      const single = await simpleOrder();
      assert.equal(await h.prisma.shopOrder.count({ where: { orderId: single.orderId } }), 1);
      const a = await product();
      const b = await product({ shop: otherShopId, price: "800.00" });
      const multi = await place([
        { shop: shopId, lines: [{ productId: a.id, quantity: 1 }] },
        { shop: otherShopId, lines: [{ productId: b.id, quantity: 3 }] },
      ]);
      const shopOrders = await h.prisma.shopOrder.findMany({ where: { orderId: multi.orderId }, orderBy: { shopName: "asc" } });
      assert.deepEqual(
        shopOrders.map(({ shopId: shop, status, total }) => [shop, status, total.toFixed(2)]),
        [
          [shopId, "PENDING", "1600.00"],
          [otherShopId, "PENDING", "2450.00"],
        ],
      );
      assert.equal(await h.prisma.delivery.count(), 0, "no delivery before confirmation");
    });
  });

  describe("seller confirmation", () => {
    it("confirms the whole shop order, creates the delivery, records history, and notifies the customer; other shops are unaffected", async () => {
      const a = await product();
      const b = await product({ shop: otherShopId });
      const placed = await place([
        { shop: shopId, lines: [{ productId: a.id, quantity: 1 }] },
        { shop: otherShopId, lines: [{ productId: b.id, quantity: 1 }] },
      ]);
      const id = placed.shopOrderId(shopId);
      const response = await post(`${sellerPath(id)}/confirm`, seller);
      assert.equal(response.status, 200);
      const view = (await response.json()) as SellerShopOrderDetail;
      assert.equal(view.status, "CONFIRMED");
      assert.equal(view.label, "PREPARING");
      assert.equal(view.deliveryStatus, "PENDING");
      assert.deepEqual(view.actions, { confirm: false, reject: false, cancel: true });

      const row = await shopOrderRow(id);
      assert.equal(row.delivery?.status, "PENDING");
      assert.ok(row.decidedAt);
      assert.equal(row.closedAt, null);
      assert.equal(row.payment?.status, "PENDING", "confirmation is not payment");
      const events = await h.prisma.shopOrderStatusEvent.findMany({ where: { shopOrderId: id }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(
        events.map(({ fromStatus, toStatus, actorType, actorUserId }) => [fromStatus, toStatus, actorType, actorUserId]),
        [
          [null, "PENDING", "CUSTOMER", customer.userId],
          ["PENDING", "CONFIRMED", "SELLER", seller.userId],
        ],
      );
      const [notification] = await notificationsOf("SHOP_ORDER_CONFIRMED");
      assert.equal(notification?.userId, customer.userId);
      assert.deepEqual(notification?.payload, { orderReference: placed.reference, shopName: "Boutique Alpha" });
      assert.equal(notification?.eventKey, `SHOP_ORDER_CONFIRMED:${events[1]?.id}:${customer.userId}`);

      const other = await shopOrderRow(placed.shopOrderId(otherShopId));
      assert.equal(other.status, "PENDING");
      assert.equal(other.delivery, null);

      const customerView = (await (await h.call(`/customers/me/orders/${placed.orderId}`, customer.token)).json()) as CustomerOrder;
      assert.deepEqual(
        customerView.shopOrders.map(({ label, canCancel }) => [label, canCancel]),
        [
          ["PREPARING", false],
          ["AWAITING_SHOP", true],
        ],
      );
    });

    it("a repeated confirmation returns the current shop order and writes nothing", async () => {
      const { id } = await simpleOrder();
      assert.equal((await post(`${sellerPath(id)}/confirm`, seller)).status, 200);
      const before = await snapshot();
      const again = await post(`${sellerPath(id)}/confirm`, seller);
      assert.equal(again.status, 200);
      assert.equal(((await again.json()) as SellerShopOrderDetail).status, "CONFIRMED");
      assert.deepEqual(await snapshot(), before);
    });

    it("shows the seller only the area before confirmation, the full snapshot after", async () => {
      const { id } = await simpleOrder();
      const pending = (await (await h.call(sellerPath(id), seller.token)).json()) as SellerShopOrderDetail;
      assert.deepEqual(pending.delivery, { stage: "LIMITED", city: "Nouakchott", district: "Tevragh Zeina" });
      const raw = JSON.stringify(pending);
      for (const hidden of ["Aïcha", "+22233000000", "mosquée", "18.086"]) assert.equal(raw.includes(hidden), false, hidden);
      const list = (await (await h.call("/sellers/me/orders", seller.token)).json()) as SellerShopOrderListResponse;
      assert.equal(JSON.stringify(list).includes("+22233000000"), false);

      await post(`${sellerPath(id)}/confirm`, seller);
      const confirmed = (await (await h.call(sellerPath(id), seller.token)).json()) as SellerShopOrderDetail;
      assert.equal(confirmed.delivery.stage, "FULL");
      assert.equal(confirmed.delivery.stage === "FULL" && confirmed.delivery.deliveryPhone, "+22233000000");
      assert.equal(confirmed.delivery.stage === "FULL" && confirmed.delivery.latitude, 18.086);
    });
  });

  describe("seller rejection", () => {
    it("rejects with a required reason: stock returned, payment cancelled, customer told the code", async () => {
      const { id, productId, orderId, reference } = await simpleOrder({ quantity: 3 });
      assert.equal(await stockOf(productId), 7);
      await expectError(await post(`${sellerPath(id)}/reject`, seller, {}), 400, "BAD_REQUEST");
      await expectError(await post(`${sellerPath(id)}/reject`, seller, { reason: "CUSTOMER_REQUESTED" }), 400, "BAD_REQUEST");
      const response = await post(`${sellerPath(id)}/reject`, seller, { reason: "OUT_OF_STOCK" });
      assert.equal(response.status, 200);
      const view = (await response.json()) as SellerShopOrderDetail;
      assert.equal(view.status, "REJECTED");
      assert.deepEqual(view.decision, { cancelledBy: null, reason: "OUT_OF_STOCK", reasonText: null });

      assert.equal(await stockOf(productId), 10);
      const row = await shopOrderRow(id);
      assert.equal(row.payment?.status, "CANCELLED");
      assert.equal(row.delivery, null, "no delivery for a rejected shop order");
      assert.ok(row.closedAt);
      assert.deepEqual(
        (await h.prisma.paymentEvent.findMany({ orderBy: { createdAt: "asc" } })).map(({ type, actorType }) => [type, actorType]),
        [
          ["CREATED", "CUSTOMER"],
          ["CANCELLED", "SELLER"],
        ],
      );
      const [notification] = await notificationsOf("SHOP_ORDER_REJECTED");
      assert.equal(notification?.userId, customer.userId);
      assert.deepEqual(notification?.payload, { orderReference: reference, shopName: "Boutique Alpha", reasonCode: "OUT_OF_STOCK" });

      const customerView = (await (await h.call(`/customers/me/orders/${orderId}`, customer.token)).json()) as CustomerOrder;
      assert.deepEqual(customerView.shopOrders[0]?.decision, { cancelledBy: null, reason: "OUT_OF_STOCK" });
      assert.equal(customerView.shopOrders[0]?.label, "REJECTED");
    });

    it("a repeated rejection writes nothing; any other mismatch is 409", async () => {
      const { id } = await simpleOrder();
      await post(`${sellerPath(id)}/reject`, seller, { reason: "PRICE_ERROR" });
      const before = await snapshot();
      assert.equal((await post(`${sellerPath(id)}/reject`, seller, { reason: "OTHER" })).status, 200);
      assert.deepEqual(await snapshot(), before);
      await expectError(await post(`${sellerPath(id)}/confirm`, seller), 409, "SHOP_ORDER_STATUS_CONFLICT");
      await expectError(await post(`${sellerPath(id)}/cancel`, seller, { reason: "OTHER" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
      assert.deepEqual(await snapshot(), before);
    });

    it("a confirmed shop order cannot be rejected, and a pending one cannot be cancelled by its seller", async () => {
      const first = await simpleOrder();
      await post(`${sellerPath(first.id)}/confirm`, seller);
      await expectError(await post(`${sellerPath(first.id)}/reject`, seller, { reason: "OTHER" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
      const second = await simpleOrder();
      await expectError(await post(`${sellerPath(second.id)}/cancel`, seller, { reason: "OTHER" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
      assert.equal((await shopOrderRow(second.id)).status, "PENDING");
    });
  });

  describe("customer cancellation", () => {
    it("cancels while PENDING; OTHER needs the text; the seller sees code and text, the customer neither", async () => {
      const { id, orderId, productId, reference } = await simpleOrder({ quantity: 4 });
      await expectError(await post(customerCancelPath(orderId, id), customer, { reason: "OTHER" }), 400, "BAD_REQUEST");
      await expectError(await post(customerCancelPath(orderId, id), customer, { reason: "CHANGED_MIND", reasonText: CUSTOMER_TEXT }), 400, "BAD_REQUEST");
      const response = await post(customerCancelPath(orderId, id), customer, { reason: "OTHER", reasonText: CUSTOMER_TEXT });
      assert.equal(response.status, 200);
      const view = (await response.json()) as CustomerOrder;
      assert.equal(view.shopOrders[0]?.status, "CANCELLED");
      assert.deepEqual(view.shopOrders[0]?.decision, { cancelledBy: "CUSTOMER", reason: null });
      assert.equal(JSON.stringify(view).includes(CUSTOMER_TEXT), false);
      assert.equal(view.shopOrders[0]?.canCancel, false);
      assert.equal(await stockOf(productId), 10);
      assert.equal((await shopOrderRow(id)).payment?.status, "CANCELLED");

      const sellerView = (await (await h.call(sellerPath(id), seller.token)).json()) as SellerShopOrderDetail;
      assert.deepEqual(sellerView.decision, { cancelledBy: "CUSTOMER", reason: "OTHER", reasonText: CUSTOMER_TEXT });

      const notifications = await notificationsOf("SHOP_ORDER_CANCELLED");
      assert.deepEqual(
        notifications.map(({ userId }) => userId),
        [seller.userId],
      );
      assert.deepEqual(notifications[0]?.payload, { orderReference: reference, shopName: "Boutique Alpha", cancelledBy: "CUSTOMER", reasonCode: "OTHER" });
      assert.equal(JSON.stringify(notifications).includes(CUSTOMER_TEXT), false, "the customer's text never goes into a notification");
    });

    it("accepts an empty body, repeats write nothing, and a confirmed order cannot be cancelled by its customer", async () => {
      const first = await simpleOrder();
      assert.equal((await h.call(customerCancelPath(first.orderId, first.id), customer.token, { method: "POST" })).status, 200);
      const before = await snapshot();
      assert.equal((await post(customerCancelPath(first.orderId, first.id), customer, { reason: "CHANGED_MIND" })).status, 200);
      assert.deepEqual(await snapshot(), before);

      const second = await simpleOrder();
      await post(`${sellerPath(second.id)}/confirm`, seller);
      await expectError(await post(customerCancelPath(second.orderId, second.id), customer, {}), 409, "SHOP_ORDER_STATUS_CONFLICT");
      assert.equal((await shopOrderRow(second.id)).status, "CONFIRMED");
    });
  });

  describe("seller cancellation after confirmation", () => {
    it("cancels a confirmed shop order with a reason: delivery cancelled, stock returned, payment cancelled, customer told", async () => {
      const { id, productId, orderId } = await simpleOrder({ quantity: 2 });
      await post(`${sellerPath(id)}/confirm`, seller);
      await expectError(await post(`${sellerPath(id)}/cancel`, seller, {}), 400, "BAD_REQUEST");
      const response = await post(`${sellerPath(id)}/cancel`, seller, { reason: "CUSTOMER_REQUESTED" });
      assert.equal(response.status, 200);
      const row = await shopOrderRow(id);
      assert.equal(row.status, "CANCELLED");
      assert.equal(row.cancelledBy, "SELLER");
      assert.equal(row.delivery?.status, "CANCELLED");
      assert.equal(row.payment?.status, "CANCELLED");
      assert.equal(await stockOf(productId), 10);
      assert.deepEqual(
        (await h.prisma.deliveryStatusEvent.findMany({ orderBy: { createdAt: "asc" } })).map(({ fromStatus, toStatus }) => [fromStatus, toStatus]),
        [
          [null, "PENDING"],
          ["PENDING", "CANCELLED"],
        ],
      );
      const notifications = await notificationsOf("SHOP_ORDER_CANCELLED");
      assert.deepEqual(
        notifications.map(({ userId }) => userId),
        [customer.userId],
      );
      const customerView = (await (await h.call(`/customers/me/orders/${orderId}`, customer.token)).json()) as CustomerOrder;
      assert.deepEqual(customerView.shopOrders[0]?.decision, { cancelledBy: "SELLER", reason: "CUSTOMER_REQUESTED" });
      const before = await snapshot();
      assert.equal((await post(`${sellerPath(id)}/cancel`, seller, { reason: "OTHER" })).status, 200);
      assert.deepEqual(await snapshot(), before);
    });

    it("nobody can cancel once the delivery is out for delivery (or failed)", async () => {
      for (const status of ["OUT_FOR_DELIVERY", "FAILED"] as const) {
        const { id, orderId } = await simpleOrder();
        await post(`${sellerPath(id)}/confirm`, seller);
        await h.prisma.delivery.update({ where: { shopOrderId: id }, data: { status } });
        const before = await snapshot();
        await expectError(await post(`${sellerPath(id)}/cancel`, seller, { reason: "OTHER" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
        await expectError(await post(`${adminPath(id)}/cancel`, admin, { internalReason: INTERNAL_REASON }), 409, "SHOP_ORDER_STATUS_CONFLICT");
        await expectError(await post(customerCancelPath(orderId, id), customer, {}), 409, "SHOP_ORDER_STATUS_CONFLICT");
        assert.deepEqual(await snapshot(), before);
        const view = (await (await h.call(sellerPath(id), seller.token)).json()) as SellerShopOrderDetail;
        assert.equal(view.actions.cancel, false);
      }
    });

    it("an ASSIGNED delivery can still be cancelled", async () => {
      const { id } = await simpleOrder();
      await post(`${sellerPath(id)}/confirm`, seller);
      await h.prisma.delivery.update({ where: { shopOrderId: id }, data: { status: "ASSIGNED" } });
      assert.equal((await post(`${sellerPath(id)}/cancel`, seller, { reason: "OUT_OF_STOCK" })).status, 200);
      assert.equal((await shopOrderRow(id)).delivery?.status, "CANCELLED");
    });
  });

  describe("administrator cancellation", () => {
    it("cancels before dispatch with an internal reason; customers see only Chicman; sellers never see the reason", async () => {
      const pending = await simpleOrder();
      const confirmed = await simpleOrder();
      await post(`${sellerPath(confirmed.id)}/confirm`, seller);
      await expectError(await post(`${adminPath(pending.id)}/cancel`, admin, {}), 400, "BAD_REQUEST");
      await expectError(await post(`${adminPath(pending.id)}/cancel`, admin, { internalReason: "court" }), 400, "BAD_REQUEST");

      for (const { id } of [pending, confirmed]) {
        const response = await post(`${adminPath(id)}/cancel`, admin, { internalReason: INTERNAL_REASON, internalNote: INTERNAL_NOTE });
        assert.equal(response.status, 200);
        const detail = (await response.json()) as AdminShopOrderDetail;
        assert.equal(detail.status, "CANCELLED");
        assert.deepEqual(detail.decision, { cancelledBy: "ADMIN", reasonCode: null, reasonText: null, internalReason: INTERNAL_REASON, internalNote: INTERNAL_NOTE });
        assert.equal(detail.history.at(-1)?.actorUserId, admin.userId);
        assert.equal(detail.history.at(-1)?.internalReason, INTERNAL_REASON);
        assert.equal(detail.stockMovements.filter(({ type }) => type === "RETURNED").length, 1);
        assert.equal(detail.canCancel, false);
      }
      assert.equal((await shopOrderRow(confirmed.id)).delivery?.status, "CANCELLED");

      for (const { orderId } of [pending, confirmed]) {
        const view = (await (await h.call(`/customers/me/orders/${orderId}`, customer.token)).json()) as CustomerOrder;
        assert.deepEqual(view.shopOrders[0]?.decision, { cancelledBy: "CHICMAN", reason: null });
        assert.equal(JSON.stringify(view).includes(INTERNAL_REASON) || JSON.stringify(view).includes(INTERNAL_NOTE), false);
      }
      const sellerView = await (await h.call(sellerPath(pending.id), seller.token)).text();
      const sellerList = await (await h.call("/sellers/me/orders", seller.token)).text();
      const customerList = await (await h.call("/customers/me/orders", customer.token)).text();
      for (const body of [sellerView, sellerList, customerList]) {
        assert.equal(body.includes(INTERNAL_REASON) || body.includes(INTERNAL_NOTE), false);
      }
      assert.deepEqual((JSON.parse(sellerView) as SellerShopOrderDetail).decision, { cancelledBy: "CHICMAN", reason: null, reasonText: null });

      const notifications = await notificationsOf("SHOP_ORDER_CANCELLED");
      assert.equal(notifications.length, 4, "customer and seller, for each of the two");
      assert.equal(JSON.stringify(notifications).includes(INTERNAL_REASON) || JSON.stringify(notifications).includes(INTERNAL_NOTE), false);
      for (const notification of notifications) {
        assert.deepEqual((notification.payload as { cancelledBy: string; reasonCode: unknown }).cancelledBy, "CHICMAN");
        assert.equal((notification.payload as { reasonCode: unknown }).reasonCode, null);
      }

      const before = await snapshot();
      assert.equal((await post(`${adminPath(pending.id)}/cancel`, admin, { internalReason: INTERNAL_REASON })).status, 200);
      assert.deepEqual(await snapshot(), before);
    });

    it("is refused on the administrator's own shop (403) and writes nothing", async () => {
      const adminSeller = await h.actor(["CUSTOMER", "SELLER", "ADMIN"]);
      const { shopId: ownShop } = await h.shopInStatus("APPROVED", adminSeller);
      const { id } = await simpleOrder({ shop: ownShop });
      const before = await snapshot();
      await expectError(await post(`${adminPath(id)}/cancel`, adminSeller, { internalReason: INTERNAL_REASON }), 403, "SHOP_SELF_ADMINISTRATION_FORBIDDEN");
      assert.deepEqual(await snapshot(), before);
      const detail = (await (await h.call(adminPath(id), adminSeller.token)).json()) as AdminShopOrderDetail;
      assert.equal(detail.canCancel, false);
      // Order of checks: body 400, unknown 404, own shop 403.
      await expectError(await post(`${adminPath(id)}/cancel`, adminSeller, {}), 400, "BAD_REQUEST");
      await expectError(await post(`${adminPath(randomUUID())}/cancel`, adminSeller, { internalReason: INTERNAL_REASON }), 404, "SHOP_ORDER_NOT_FOUND");
    });

    it("lists every shop order with filters, and shows everything in the detail", async () => {
      const first = await simpleOrder();
      const second = await simpleOrder({ shop: otherShopId });
      await post(`${sellerPath(first.id)}/reject`, seller, { reason: "OTHER" });
      const all = (await (await h.call("/admin/orders", admin.token)).json()) as AdminShopOrderListResponse;
      assert.equal(all.total, 2);
      const byShop = (await (await h.call(`/admin/orders?shopId=${otherShopId}`, admin.token)).json()) as AdminShopOrderListResponse;
      assert.deepEqual(
        byShop.shopOrders.map(({ id }) => id),
        [second.id],
      );
      const rejected = (await (await h.call("/admin/orders?status=REJECTED", admin.token)).json()) as AdminShopOrderListResponse;
      assert.deepEqual(
        rejected.shopOrders.map(({ id }) => id),
        [first.id],
      );
      const today = new Date().toISOString().slice(0, 10);
      assert.equal(((await (await h.call(`/admin/orders?from=${today}&to=${today}`, admin.token)).json()) as AdminShopOrderListResponse).total, 2);
      assert.equal(((await (await h.call("/admin/orders?to=2020-01-01", admin.token)).json()) as AdminShopOrderListResponse).total, 0);
      await expectError(await h.call("/admin/orders?from=nope", admin.token), 400, "BAD_REQUEST");

      const detail = (await (await h.call(adminPath(first.id), admin.token)).json()) as AdminShopOrderDetail;
      assert.equal(detail.customerUserId, customer.userId);
      assert.equal(detail.delivery.deliveryPhone, "+22233000000");
      assert.deepEqual(
        detail.stockMovements.map(({ type, applied }) => [type, applied]),
        [
          ["TAKEN", true],
          ["RETURNED", true],
        ],
      );
      assert.deepEqual(
        detail.payment.events.map(({ type }) => type),
        ["CREATED", "CANCELLED"],
      );
    });
  });

  describe("response deadline and expiry", () => {
    it("refuses late decisions with SHOP_ORDER_EXPIRED, applying the expiry first even if the job has not run", async () => {
      for (const attempt of ["confirm", "reject", "customer-cancel", "admin-cancel"] as const) {
        await h.reset();
        ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
        customer = await h.actor();
        admin = await h.actor(["CUSTOMER", "ADMIN"]);
        const { id, orderId, productId } = await simpleOrder({ quantity: 3, placedAt: pastDeadline() });
        assert.equal(await stockOf(productId), 7);
        const response =
          attempt === "confirm"
            ? await post(`${sellerPath(id)}/confirm`, seller)
            : attempt === "reject"
              ? await post(`${sellerPath(id)}/reject`, seller, { reason: "OTHER" })
              : attempt === "customer-cancel"
                ? await post(customerCancelPath(orderId, id), customer, {})
                : await post(`${adminPath(id)}/cancel`, admin, { internalReason: INTERNAL_REASON });
        await expectError(response, 409, "SHOP_ORDER_EXPIRED");
        const row = await shopOrderRow(id);
        assert.equal(row.status, "EXPIRED", attempt);
        assert.equal(row.payment?.status, "CANCELLED");
        assert.equal(row.delivery, null);
        assert.equal(await stockOf(productId), 10);
        assert.equal((await notificationsOf("SHOP_ORDER_EXPIRED")).length, 2);
        // Still refused afterwards, and nothing more is written.
        const before = await snapshot();
        await expectError(await post(`${sellerPath(id)}/confirm`, seller), 409, "SHOP_ORDER_EXPIRED");
        assert.deepEqual(await snapshot(), before);
      }
    });

    it("the expiry job expires only due shop orders, notifies both parties, and a second run changes nothing", async () => {
      const due = await simpleOrder({ placedAt: pastDeadline() });
      const fresh = await simpleOrder();
      const result = await h.orderLifecycle.expireDue();
      assert.deepEqual(result, { done: 1, failed: 0 });
      assert.equal((await shopOrderRow(due.id)).status, "EXPIRED");
      assert.equal((await shopOrderRow(fresh.id)).status, "PENDING");
      const notifications = await notificationsOf("SHOP_ORDER_EXPIRED");
      assert.deepEqual(notifications.map(({ userId }) => userId).sort(), [customer.userId, seller.userId].sort());
      const before = await snapshot();
      assert.deepEqual(await h.orderLifecycle.expireDue(), { done: 0, failed: 0 });
      assert.deepEqual(await snapshot(), before);
      const event = await h.prisma.shopOrderStatusEvent.findFirst({ where: { shopOrderId: due.id, toStatus: "EXPIRED" } });
      assert.equal(event?.actorType, "SYSTEM");
    });

    it("concurrent job runs and requests expire each shop order exactly once", async () => {
      const due = await Promise.all([1, 2, 3].map(() => simpleOrder({ placedAt: pastDeadline(), quantity: 1 })));
      const [first, second, request] = await Promise.all([
        h.orderLifecycle.expireDue(),
        h.orderLifecycle.expireDue(),
        post(`${sellerPath(due[0]?.id ?? "")}/confirm`, seller),
      ]);
      await expectError(request, 409, "SHOP_ORDER_EXPIRED");
      assert.ok(first.done + second.done <= 3);
      assert.equal(await h.prisma.shopOrder.count({ where: { status: "EXPIRED" } }), 3);
      assert.equal(await h.prisma.shopOrderStatusEvent.count({ where: { toStatus: "EXPIRED" } }), 3);
      assert.equal(await h.prisma.stockMovement.count({ where: { type: "RETURNED" } }), 3);
      assert.equal(await h.prisma.paymentEvent.count({ where: { type: "CANCELLED" } }), 3);
    });
  });

  describe("reminder", () => {
    it("records one seller reminder once half the time has passed, never twice", async () => {
      const halfway = await simpleOrder({ placedAt: new Date(Date.now() - 25 * HOUR) });
      await simpleOrder();
      const confirmed = await simpleOrder({ placedAt: new Date(Date.now() - 25 * HOUR) });
      await post(`${sellerPath(confirmed.id)}/confirm`, seller);
      const [a, b] = await Promise.all([h.orderLifecycle.remindDue(), h.orderLifecycle.remindDue()]);
      assert.equal((a?.done ?? 0) + (b?.done ?? 0) >= 1, true);
      const reminders = await notificationsOf("SHOP_ORDER_RESPONSE_REMINDER");
      assert.equal(reminders.length, 1);
      assert.equal(reminders[0]?.userId, seller.userId);
      assert.equal(reminders[0]?.eventKey, `SHOP_ORDER_RESPONSE_REMINDER:${halfway.id}:${seller.userId}`);
      assert.deepEqual(Object.keys(reminders[0]?.payload as object).sort(), ["orderReference", "respondBy"]);
      assert.deepEqual(await h.orderLifecycle.remindDue(), { done: 0, failed: 0 });
      assert.equal((await notificationsOf("SHOP_ORDER_RESPONSE_REMINDER")).length, 1);
    });

    it("the expiry and reminder jobs each have their own advisory lock", async (t) => {
      if (databaseUrl === undefined) return t.skip();
      for (const name of [ORDER_EXPIRY_LOCK_NAME, ORDER_REMINDER_LOCK_NAME]) {
        const first = createAdvisoryLock(databaseUrl, () => undefined, name);
        const second = createAdvisoryLock(databaseUrl, () => undefined, name);
        try {
          assert.equal(await first.tryAcquire(), true);
          assert.equal(await second.tryAcquire(), false, `a second worker does not run ${name}`);
        } finally {
          await first.release();
          await second.release();
        }
      }
      assert.notEqual(ORDER_EXPIRY_LOCK_NAME, ORDER_REMINDER_LOCK_NAME);
    });
  });

  describe("order stock returns (D1)", () => {
    it("returns stock exactly once per item, even if the return runs again", async () => {
      const p = await product({ stock: 10, variants: [{ size: "M", stock: 5 }] });
      const plain = await product({ stock: 8 });
      const placed = await place([
        {
          shop: shopId,
          lines: [
            { productId: p.id, variantId: p.variantIds[0] ?? "", quantity: 2 },
            { productId: plain.id, quantity: 3 },
          ],
        },
      ]);
      const id = placed.shopOrderId(shopId);
      assert.equal((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: p.variantIds[0] ?? "" } })).stock, 3);
      await post(`${sellerPath(id)}/reject`, seller, { reason: "OTHER" });
      assert.equal((await h.prisma.productVariant.findUniqueOrThrow({ where: { id: p.variantIds[0] ?? "" } })).stock, 5);
      assert.equal(await stockOf(plain.id), 8);
      const before = await snapshot();
      const again = await h.prisma.$transaction((tx) => returnOrderStock(tx, id, new Date()));
      assert.deepEqual(again, { returned: 0, skipped: 0 });
      assert.deepEqual(await snapshot(), before);
    });

    it("records unappliable returns as skipped and still succeeds", async () => {
      const removed = await product({ variants: [{ size: "L", stock: 4 }] });
      const restructured = await product({ stock: 6 });
      const full = await product({ stock: 10 });
      const placed = await place([
        {
          shop: shopId,
          lines: [
            { productId: removed.id, variantId: removed.variantIds[0] ?? "", quantity: 1 },
            { productId: restructured.id, quantity: 2 },
            { productId: full.id, quantity: 5 },
          ],
        },
      ]);
      const id = placed.shopOrderId(shopId);
      await h.prisma.productVariant.delete({ where: { id: removed.variantIds[0] ?? "" } });
      await h.prisma.productVariant.create({ data: { productId: restructured.id, size: "S", stock: 1 } });
      await h.prisma.product.update({ where: { id: full.id }, data: { stock: 999_998 } });

      assert.equal((await post(`${sellerPath(id)}/reject`, seller, { reason: "OUT_OF_STOCK" })).status, 200);
      const returned = await h.prisma.stockMovement.findMany({ where: { type: "RETURNED" }, include: { orderItem: { select: { productId: true } } } });
      const byProduct = new Map(returned.map((movement) => [movement.orderItem.productId, [movement.applied, movement.skipReason, movement.quantity]]));
      assert.deepEqual(byProduct.get(removed.id), [false, "VARIANT_REMOVED", 1]);
      assert.deepEqual(byProduct.get(restructured.id), [false, "VARIANT_STRUCTURE_CHANGED", 2]);
      assert.deepEqual(byProduct.get(full.id), [false, "ABOVE_MAXIMUM", 5]);
      assert.equal(await stockOf(full.id), 999_998, "nothing is returned above the maximum");
      assert.equal(await stockOf(restructured.id), 4);
    });

    it("returns stock to archived products and needs no approved seller", async () => {
      const { id, productId } = await simpleOrder({ quantity: 2 });
      await h.prisma.product.update({ where: { id: productId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal((await post(`${adminPath(id)}/cancel`, admin, { internalReason: INTERNAL_REASON })).status, 200);
      assert.equal(await stockOf(productId), 10);
    });
  });

  describe("shop suspension (D8)", () => {
    it("cancels pending and not-yet-dispatched shop orders in the suspension transaction and leaves deliveries under way alone", async () => {
      const pending = await simpleOrder({ quantity: 1 });
      const confirmed = await simpleOrder({ quantity: 1 });
      const assigned = await simpleOrder({ quantity: 1 });
      const out = await simpleOrder({ quantity: 1 });
      const delivered = await simpleOrder({ quantity: 1 });
      const otherShop = await simpleOrder({ shop: otherShopId, quantity: 1 });
      for (const { id } of [confirmed, assigned, out, delivered]) await post(`${sellerPath(id)}/confirm`, seller);
      await h.prisma.delivery.update({ where: { shopOrderId: assigned.id }, data: { status: "ASSIGNED" } });
      await h.prisma.delivery.update({ where: { shopOrderId: out.id }, data: { status: "OUT_FOR_DELIVERY" } });
      await h.prisma.$transaction((tx) => markShopOrderDelivered(tx, delivered.id, seller.userId, new Date()));

      const response = await post(`/admin/shops/${shopId}/suspend`, admin, { internalReason: "Suspension pour contrôle qualité" });
      assert.equal(response.status, 200);

      for (const { id, productId } of [pending, confirmed, assigned]) {
        const row = await shopOrderRow(id);
        assert.equal(row.status, "CANCELLED");
        assert.equal(row.cancelledBy, "SYSTEM");
        assert.equal(row.reasonCode, "SHOP_UNAVAILABLE");
        assert.equal(row.payment?.status, "CANCELLED");
        assert.equal(await stockOf(productId), 10);
      }
      assert.equal((await shopOrderRow(confirmed.id)).delivery?.status, "CANCELLED");
      assert.equal((await shopOrderRow(assigned.id)).delivery?.status, "CANCELLED");
      assert.equal((await shopOrderRow(out.id)).status, "CONFIRMED");
      assert.equal((await shopOrderRow(out.id)).delivery?.status, "OUT_FOR_DELIVERY");
      assert.equal((await shopOrderRow(delivered.id)).status, "DELIVERED");
      assert.equal((await shopOrderRow(otherShop.id)).status, "PENDING");

      const view = (await (await h.call(`/customers/me/orders/${pending.orderId}`, customer.token)).json()) as CustomerOrder;
      assert.deepEqual(view.shopOrders[0]?.decision, { cancelledBy: "SYSTEM", reason: "SHOP_UNAVAILABLE" });
      const cancelled = await notificationsOf("SHOP_ORDER_CANCELLED");
      assert.equal(cancelled.length, 6, "customer and seller for each of the three");
      for (const notification of cancelled) {
        assert.deepEqual(
          { cancelledBy: (notification.payload as { cancelledBy: string }).cancelledBy, reasonCode: (notification.payload as { reasonCode: string }).reasonCode },
          { cancelledBy: "CHICMAN", reasonCode: "SHOP_UNAVAILABLE" },
        );
      }

      // Reinstatement restores nothing.
      assert.equal((await post(`/admin/shops/${shopId}/reinstate`, admin, { internalReason: "Contrôle terminé, tout va bien" })).status, 200);
      assert.equal((await shopOrderRow(pending.id)).status, "CANCELLED");
    });

    it("a failed cancellation rolls the whole suspension back", async () => {
      const pending = await simpleOrder();
      // Fail the suspension after all of its writes, including the cancellations.
      h.faults.lifecycle.beforeDecisionCommit = () => {
        throw new Error("injected");
      };
      const before = await snapshot();
      assert.equal((await post(`/admin/shops/${shopId}/suspend`, admin, { internalReason: "Suspension pour contrôle qualité" })).status, 500);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await shopOrderRow(pending.id)).status, "PENDING");
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "APPROVED");
    });
  });

  describe("transactions and concurrency", () => {
    it("a failure inside a transition leaves nothing: status, delivery, stock, payment, history, notifications", async () => {
      const { id, orderId } = await simpleOrder();
      const confirmed = await simpleOrder();
      await post(`${sellerPath(confirmed.id)}/confirm`, seller);
      h.faults.orders.beforeCommit = () => {
        throw new Error("injected");
      };
      const before = await snapshot();
      assert.equal((await post(`${sellerPath(id)}/confirm`, seller)).status, 500);
      assert.equal((await post(`${sellerPath(id)}/reject`, seller, { reason: "OTHER" })).status, 500);
      assert.equal((await post(customerCancelPath(orderId, id), customer, {})).status, 500);
      assert.equal((await post(`${sellerPath(confirmed.id)}/cancel`, seller, { reason: "OTHER" })).status, 500);
      assert.equal((await post(`${adminPath(id)}/cancel`, admin, { internalReason: INTERNAL_REASON })).status, 500);
      assert.deepEqual(await snapshot(), before);
    });

    it("a confirmation racing a customer cancellation: exactly one wins", async () => {
      for (let round = 0; round < 5; round += 1) {
        const { id, orderId, productId } = await simpleOrder({ quantity: 1 });
        const [confirm, cancel] = await Promise.all([post(`${sellerPath(id)}/confirm`, seller), post(customerCancelPath(orderId, id), customer, {})]);
        const statuses = [confirm.status, cancel.status].sort();
        assert.deepEqual(statuses, [200, 409]);
        const row = await shopOrderRow(id);
        if (confirm.status === 200) {
          assert.equal(row.status, "CONFIRMED");
          assert.equal(await stockOf(productId), 9);
        } else {
          assert.equal(row.status, "CANCELLED");
          assert.equal(row.delivery, null);
          assert.equal(await stockOf(productId), 10);
        }
      }
    });
  });

  describe("delivery outcomes (called by spec 12)", () => {
    it("delivered keeps the stock taken; final failure returns it and fails the payment; neither applies to a pending order", async () => {
      const delivered = await simpleOrder({ quantity: 2 });
      const failed = await simpleOrder({ quantity: 3 });
      const pending = await simpleOrder();
      for (const { id } of [delivered, failed]) await post(`${sellerPath(id)}/confirm`, seller);
      const now = new Date();
      assert.equal(await h.prisma.$transaction((tx) => markShopOrderDelivered(tx, pending.id, seller.userId, now)), false);
      assert.equal(await h.prisma.$transaction((tx) => markShopOrderFailedDelivery(tx, pending.id, { type: "SYSTEM", userId: null }, now)), false);
      assert.equal(await h.prisma.$transaction((tx) => markShopOrderDelivered(tx, delivered.id, seller.userId, now)), true);
      assert.equal(await h.prisma.$transaction((tx) => markShopOrderFailedDelivery(tx, failed.id, { type: "SELLER", userId: seller.userId }, now)), true);
      assert.equal((await shopOrderRow(delivered.id)).status, "DELIVERED");
      assert.equal(await stockOf(delivered.productId), 8);
      const failedRow = await shopOrderRow(failed.id);
      assert.equal(failedRow.status, "FAILED_DELIVERY");
      assert.equal(failedRow.payment?.status, "FAILED");
      assert.equal(await stockOf(failed.productId), 10);
      assert.equal(await h.prisma.$transaction((tx) => markShopOrderDelivered(tx, delivered.id, seller.userId, now)), false, "no repeat");
      // No route sets a delivery outcome, and nobody cancels a final order.
      await expectError(await post(`${sellerPath(delivered.id)}/cancel`, seller, { reason: "OTHER" }), 409, "SHOP_ORDER_STATUS_CONFLICT");
      assert.equal((await post(`${sellerPath(delivered.id)}/deliver`, seller)).status, 404);
      const view = (await (await h.call(`/customers/me/orders/${delivered.orderId}`, customer.token)).json()) as CustomerOrder;
      assert.equal(view.shopOrders[0]?.label, "DELIVERED");
    });
  });

  describe("snapshots and history", () => {
    it("keeps purchase-time values after product, variant, shop, and profile edits", async () => {
      const p = await product({ name: "Melhfa bleue", price: "1500.00", variants: [{ size: "M", stock: 5 }] });
      const placed = await place([{ shop: shopId, lines: [{ productId: p.id, variantId: p.variantIds[0] ?? "", quantity: 1 }] }]);
      await h.prisma.product.update({ where: { id: p.id }, data: { name: "Autre nom", price: "9999.00" } });
      await h.prisma.productVariant.delete({ where: { id: p.variantIds[0] ?? "" } });
      await h.prisma.shop.update({ where: { id: shopId }, data: { shopName: "Nouveau nom", contactPhone: "+22299999999", whatsappPhone: null } });
      await h.prisma.customerProfile.update({ where: { userId: customer.userId }, data: { phone: "+22288888888", fullName: "Autre" } });
      const view = (await (await h.call(`/customers/me/orders/${placed.orderId}`, customer.token)).json()) as CustomerOrder;
      const shopOrder = view.shopOrders[0];
      assert.deepEqual(
        [shopOrder?.items[0]?.productName, shopOrder?.items[0]?.size, shopOrder?.items[0]?.unitPrice, shopOrder?.items[0]?.imageUrl],
        ["Melhfa bleue", "M", "1500.00", `https://media.test.chicman/product-images/${shopId}/${p.id}/image.webp`],
      );
      assert.deepEqual(shopOrder?.shop, { id: shopId, name: "Boutique Alpha", contactPhone: "+22236000000", whatsappPhone: "+22246000001" });
      assert.equal(shopOrder?.delivery.deliveryPhone, "+22233000000");
      assert.equal(shopOrder?.delivery.recipientName, "Aïcha Mint Ahmed");
    });

    it("lists the customer's orders newest first, paginated, with one label per shop order", async () => {
      const older = await simpleOrder({ placedAt: new Date(Date.now() - 2 * HOUR) });
      const newer = await simpleOrder();
      const page1 = (await (await h.call("/customers/me/orders?pageSize=1", customer.token)).json()) as CustomerOrderListResponse;
      assert.equal(page1.total, 2);
      assert.deepEqual(
        page1.orders.map(({ id }) => id),
        [newer.orderId],
      );
      assert.deepEqual(page1.orders[0]?.shopOrders.map(({ label }) => label), ["AWAITING_SHOP"]);
      assert.equal(page1.orders[0]?.itemsCount, 2);
      const page2 = (await (await h.call("/customers/me/orders?pageSize=1&page=2", customer.token)).json()) as CustomerOrderListResponse;
      assert.deepEqual(
        page2.orders.map(({ id }) => id),
        [older.orderId],
      );
      await expectError(await h.call("/customers/me/orders?pageSize=51", customer.token), 400, "BAD_REQUEST");
    });

    it("filters the seller list by status", async () => {
      const first = await simpleOrder();
      await simpleOrder();
      await post(`${sellerPath(first.id)}/confirm`, seller);
      const confirmed = (await (await h.call("/sellers/me/orders?status=CONFIRMED", seller.token)).json()) as SellerShopOrderListResponse;
      assert.deepEqual(
        confirmed.shopOrders.map(({ id, label }) => [id, label]),
        [[first.id, "PREPARING"]],
      );
      await expectError(await h.call("/sellers/me/orders?status=NOPE", seller.token), 400, "BAD_REQUEST");
    });
  });
});
