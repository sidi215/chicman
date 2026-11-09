import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  checkoutPlacementSchema,
  expectedFigures,
  shopUpdateSchema,
  type CheckoutSummary,
  type CustomerOrder,
  type OwnerShopResponse,
  type SellerProductDetail,
} from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { runProductImageCleanup } from "../src/modules/products/index.js";
import { CHECKOUT_RATE_LIMIT, MEDIA_BASE_URL, ShopHarness, TEST_TIMING, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("checkout contract (spec 10)", () => {
  const valid = {
    addressId: randomUUID(),
    recipientName: "Aïcha Mint Ahmed",
    expected: { total: "1600", shops: [{ shopId: randomUUID(), productsSubtotal: "1500.00", deliveryFee: "100" }] },
  };

  it("normalizes amounts to two decimals and the name to NFC", () => {
    const parsed = checkoutPlacementSchema.parse({ ...valid, recipientName: "  Aïcha  " });
    assert.equal(parsed.recipientName, "Aïcha");
    assert.equal(parsed.expected.total, "1600.00");
    assert.equal(parsed.expected.shops[0]?.deliveryFee, "100.00");
  });

  it("refuses client prices, owners, stock, numbers, and unknown fields", () => {
    for (const body of [
      { ...valid, userId: randomUUID() },
      { ...valid, items: [] },
      { ...valid, expected: { ...valid.expected, total: 1600 } },
      { ...valid, expected: { ...valid.expected, shops: [] } },
      { ...valid, expected: { ...valid.expected, shops: [{ ...valid.expected.shops[0], unitPrice: "1.00" }] } },
      { ...valid, expected: { ...valid.expected, shops: [{ ...valid.expected.shops[0], deliveryFee: "-1" }] } },
      { ...valid, recipientName: "" },
      { ...valid, recipientName: "   " },
      { ...valid, recipientName: "x".repeat(101) },
      { ...valid, recipientName: "Ali\u0007" },
      { ...valid, addressId: "not-a-uuid" },
    ]) {
      assert.equal(checkoutPlacementSchema.safeParse(body).success, false, JSON.stringify(body));
    }
    assert.equal(checkoutPlacementSchema.safeParse({ ...valid, recipientName: "x".repeat(100) }).success, true);
  });

  it("accepts a zero delivery fee but never clears it once set (spec 06)", () => {
    assert.equal(shopUpdateSchema.parse({ deliveryFee: "0" }).deliveryFee, "0.00");
    for (const deliveryFee of [null, -5, 150, "-1", "1.234", "abc", "12345678901"]) {
      assert.equal(shopUpdateSchema.safeParse({ deliveryFee }).success, false, String(deliveryFee));
    }
  });
});

describe("checkout (spec 10, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let customer: Actor;
  let addressId: string;
  let tiny: Buffer;

  const sellerBase = "/sellers/me/products";
  const cartPath = "/customers/me/cart";
  const checkoutPath = "/customers/me/checkout";

  before(async () => {
    await h.start();
    tiny = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: 10, g: 120, b: 90 } } })
      .png()
      .toBuffer();
  });
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: shopId }, data: { deliveryFee: "100.00", whatsappPhone: "+22246000001" } });
    customer = await h.actor();
    await h.prisma.customerProfile.update({ where: { userId: customer.userId }, data: { fullName: "Aïcha Mint Ahmed", phone: "+22222111111" } });
    addressId = await address(customer);
  });

  const post = (path: string, actor: Actor, body?: unknown, headers?: Record<string, string>) =>
    h.call(path, actor.token, { method: "POST", body, ...(headers === undefined ? {} : { headers }) });

  async function address(actor: Actor, data: { deliveryPhone?: string | null; isDefault?: boolean; label?: string } = {}): Promise<string> {
    const row = await h.prisma.customerAddress.create({
      data: {
        userId: actor.userId,
        label: data.label ?? "Maison",
        city: "Nouakchott",
        district: "Tevragh Zeina",
        landmark: "Près de la mosquée bleue",
        deliveryPhone: data.deliveryPhone === undefined ? "+22233000000" : data.deliveryPhone,
        latitude: "18.086000",
        longitude: "-15.975000",
        locationSource: "MANUAL",
        locationConfirmedAt: new Date(),
        isDefault: data.isDefault ?? true,
      },
    });
    return row.id;
  }

  interface Spec {
    name?: string;
    price?: string;
    stock?: number;
    variants?: { size?: string; color?: string; stock?: number }[];
    actor?: Actor;
    shop?: string;
  }

  async function uploadImage(actor: Actor, shop: string, productId: string): Promise<void> {
    const upload = await post(`${sellerBase}/${productId}/images/uploads`, actor, { contentType: "image/png", contentLength: tiny.byteLength });
    assert.equal(upload.status, 201);
    const { uploadId } = (await upload.json()) as { uploadId: string };
    h.storage.staging.set(`product-images/${shop}/${productId}/${uploadId}`, tiny);
    assert.equal((await post(`${sellerBase}/${productId}/images/uploads/${uploadId}/complete`, actor)).status, 200);
  }

  async function product(spec: Spec = {}): Promise<SellerProductDetail> {
    const actor = spec.actor ?? seller;
    const shop = spec.shop ?? shopId;
    const created = await post(sellerBase, actor, {
      name: spec.name ?? "Melhfa",
      description: "Voile léger.",
      category: "CLOTHING",
      price: spec.price ?? "1500.00",
      stock: spec.stock ?? 5,
    });
    assert.equal(created.status, 201);
    const { id } = (await created.json()) as SellerProductDetail;
    await uploadImage(actor, shop, id);
    for (const variant of spec.variants ?? []) assert.equal((await post(`${sellerBase}/${id}/variants`, actor, variant)).status, 201);
    assert.equal((await post(`${sellerBase}/${id}/publish`, actor)).status, 200);
    return (await (await h.call(`${sellerBase}/${id}`, actor.token)).json()) as SellerProductDetail;
  }

  async function secondShop(fee: string | null = "50.00"): Promise<{ actor: Actor; shop: string }> {
    const { owner, shopId: shop } = await h.shopInStatus("APPROVED");
    await h.prisma.shop.update({ where: { id: shop }, data: { shopName: "Autre Boutique", deliveryFee: fee, contactPhone: "+22237000000" } });
    return { actor: owner, shop };
  }

  /** A shop the customer owns, approved, with a fee (O2). */
  async function ownShop(): Promise<{ shopId: string }> {
    const owned = await h.shopInStatus("APPROVED", customer);
    await h.prisma.userRole.create({ data: { userId: customer.userId, role: "SELLER" } });
    await h.prisma.shop.update({ where: { id: owned.shopId }, data: { deliveryFee: "10.00" } });
    return { shopId: owned.shopId };
  }

  async function add(productId: string, quantity: number, variantId?: string, actor: Actor = customer): Promise<void> {
    const response = await post(`${cartPath}/items`, actor, { productId, quantity, ...(variantId === undefined ? {} : { variantId }) });
    assert.equal(response.status, 200);
  }

  async function summary(actor: Actor = customer, query = ""): Promise<CheckoutSummary> {
    const response = await h.call(`${checkoutPath}${query}`, actor.token);
    assert.equal(response.status, 200);
    return (await response.json()) as CheckoutSummary;
  }

  const place = (body: unknown, key: string | null = randomUUID(), actor: Actor = customer) =>
    post(checkoutPath, actor, body, key === null ? {} : { "Idempotency-Key": key });

  /** The body a client builds from the summary the customer is shown. */
  async function bodyFromSummary(actor: Actor = customer, recipientName = "Aïcha Mint Ahmed") {
    const shown = await summary(actor);
    const expected = expectedFigures(shown);
    assert.ok(expected, "the summary has every fee");
    return { addressId: shown.address?.addressId ?? addressId, recipientName, expected };
  }

  async function placed(response: Response, status = 201): Promise<CustomerOrder> {
    assert.equal(response.status, status);
    return (await response.json()) as CustomerOrder;
  }

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  /** Every row placement writes or removes, to prove that a refusal changes nothing. */
  async function snapshot() {
    return {
      orders: await h.prisma.order.count(),
      shopOrders: await h.prisma.shopOrder.count(),
      items: await h.prisma.orderItem.count(),
      events: await h.prisma.shopOrderStatusEvent.count(),
      movements: await h.prisma.stockMovement.count(),
      payments: await h.prisma.payment.count(),
      paymentEvents: await h.prisma.paymentEvent.count(),
      notifications: await h.prisma.notification.count(),
      cartLines: await h.prisma.cartItem.findMany({ orderBy: { id: "asc" }, select: { id: true, quantity: true, priceSnapshot: true } }),
      stock: await h.prisma.product.findMany({ orderBy: { id: "asc" }, select: { id: true, stock: true } }),
      variantStock: await h.prisma.productVariant.findMany({ orderBy: { id: "asc" }, select: { id: true, stock: true } }),
    };
  }

  describe("authorization", () => {
    it("requires a signed-in, bootstrapped user", async () => {
      assert.equal((await h.call(checkoutPath, null)).status, 401);
      assert.equal((await h.call(checkoutPath, null, { method: "POST", body: {} })).status, 401);
    });

    it("takes the customer from the token: a body naming another user is refused", async () => {
      const created = await product();
      await add(created.id, 1);
      const body = await bodyFromSummary();
      await expectError(await place({ ...body, userId: seller.userId }), 400, "BAD_REQUEST");
      assert.equal(await h.prisma.order.count(), 0);
    });

    it("never uses another customer's address (404), in the summary or at placement", async () => {
      const created = await product();
      await add(created.id, 1);
      const other = await h.actor();
      const theirs = await address(other);
      await expectError(await h.call(`${checkoutPath}?addressId=${theirs}`, customer.token), 404, "ADDRESS_NOT_FOUND");
      const body = await bodyFromSummary();
      await expectError(await place({ ...body, addressId: theirs }), 404, "ADDRESS_NOT_FOUND");
      await expectError(await place({ ...body, addressId: randomUUID() }), 404, "ADDRESS_NOT_FOUND");
      assert.equal(await h.prisma.order.count(), 0);
    });

    it("refuses a malformed summary query", async () => {
      await expectError(await h.call(`${checkoutPath}?addressId=nope`, customer.token), 400, "BAD_REQUEST");
      await expectError(await h.call(`${checkoutPath}?other=1`, customer.token), 400, "BAD_REQUEST");
    });
  });

  describe("summary", () => {
    it("reports an empty cart and writes nothing", async () => {
      const shown = await summary();
      assert.deepEqual(shown.problems, [{ code: "CART_EMPTY" }]);
      assert.equal(shown.total, "0.00");
      assert.equal(await h.prisma.cart.count(), 0);
    });

    it("shows per-shop subtotals, the fee once per shop, the total, the address, and COD", async () => {
      const first = await product({ price: "1500.00" });
      const second = await product({ name: "Voile", price: "250.50" });
      const other = await secondShop("0.00");
      const third = await product({ actor: other.actor, shop: other.shop, name: "Sandales", price: "800.00" });
      await add(first.id, 2);
      await add(second.id, 1);
      await add(third.id, 1);

      const before = await snapshot();
      const shown = await summary();
      assert.deepEqual(shown.problems, []);
      assert.deepEqual(
        shown.shops.map(({ shop, productsSubtotal, deliveryFee, total, items }) => [shop.id, productsSubtotal, deliveryFee, total, items.length]),
        [
          [shopId, "3250.50", "100.00", "3350.50", 2],
          [other.shop, "800.00", "0.00", "800.00", 1],
        ],
      );
      assert.equal(shown.productsSubtotal, "4050.50");
      assert.equal(shown.deliveryFeeTotal, "100.00");
      assert.equal(shown.total, "4150.50");
      assert.equal(shown.itemCount, 4);
      assert.equal(shown.paymentMethod, "CASH_ON_DELIVERY");
      assert.equal(shown.defaultRecipientName, "Aïcha Mint Ahmed");
      assert.equal(shown.address?.addressId, addressId);
      assert.equal(shown.address?.deliveryPhone, "+22233000000");
      assert.deepEqual(await snapshot(), before);
    });

    it("uses the default address without a choice, the chosen one with it, and the profile phone when the address has none", async () => {
      const created = await product();
      await add(created.id, 1);
      const office = await address(customer, { deliveryPhone: null, isDefault: false, label: "Bureau" });
      assert.equal((await summary()).address?.addressId, addressId);
      const chosen = await summary(customer, `?addressId=${office}`);
      assert.equal(chosen.address?.label, "Bureau");
      assert.equal(chosen.address?.deliveryPhone, "+22222111111");
    });

    it("says an address is required when the customer has none", async () => {
      await h.prisma.customerAddress.deleteMany({ where: { userId: customer.userId } });
      const created = await product();
      await add(created.id, 1);
      assert.equal((await summary()).address, null);
    });

    it("lists every blocking problem: fee not set, own shop, price change, stock, unbuyable lines", async () => {
      const unpriced = await secondShop(null);
      const feeless = await product({ actor: unpriced.actor, shop: unpriced.shop, name: "Sans frais" });
      const repriced = await product({ name: "Repriced", price: "100.00" });
      const scarce = await product({ name: "Scarce", stock: 1 });
      const archived = await product({ name: "Archived" });
      await add(feeless.id, 1);
      await add(repriced.id, 1);
      await add(scarce.id, 1);
      await add(archived.id, 1);
      await h.call(`${sellerBase}/${repriced.id}`, seller.token, { method: "PATCH", body: { price: "120.00" } });
      await h.prisma.product.update({ where: { id: scarce.id }, data: { stock: 0 } });
      assert.equal((await post(`${sellerBase}/${archived.id}/archive`, seller)).status, 200);

      const shown = await summary();
      const codes = shown.problems.map((problem) => problem.code).sort();
      assert.deepEqual(codes, ["DELIVERY_FEE_NOT_SET", "INSUFFICIENT_STOCK", "PRICE_CHANGED", "PRODUCT_ARCHIVED"]);
      assert.equal(shown.total, null);
      assert.equal(shown.shops.find(({ shop }) => shop.id === unpriced.shop)?.deliveryFee, null);
    });

    it("flags a shop the customer owns (O2)", async () => {
      const owner = await ownShop();
      const own = await product({ actor: customer, shop: owner.shopId, name: "Mon produit" });
      await add(own.id, 1);
      assert.deepEqual((await summary()).problems, [{ code: "OWN_SHOP", shopId: owner.shopId }]);
    });
  });

  describe("placement", () => {
    it("creates one order, one PENDING shop order with its deadline, items, payment, history, stock movement, and notification", async () => {
      const created = await product({ price: "1500.00", stock: 5 });
      await add(created.id, 2);
      const order = await placed(await place(await bodyFromSummary()));

      assert.match(order.reference, /^CM-[0-9A-HJKMNP-TV-Z]{10}$/);
      assert.equal(order.productsSubtotal, "3000.00");
      assert.equal(order.deliveryFeeTotal, "100.00");
      assert.equal(order.total, "3100.00");
      assert.equal(order.paymentMethod, "CASH_ON_DELIVERY");
      assert.equal(order.shopOrders.length, 1);
      const [shopOrder] = order.shopOrders;
      assert.ok(shopOrder);
      assert.equal(shopOrder.status, "PENDING");
      assert.equal(shopOrder.label, "AWAITING_SHOP");
      assert.equal(new Date(shopOrder.respondBy).getTime() - new Date(order.createdAt).getTime(), 48 * 3_600_000);
      assert.deepEqual(shopOrder.shop, { id: shopId, name: "Boutique Test", contactPhone: "+22236000000", whatsappPhone: "+22246000001" });
      assert.deepEqual([shopOrder.productsSubtotal, shopOrder.deliveryFee, shopOrder.total], ["3000.00", "100.00", "3100.00"]);
      assert.deepEqual(shopOrder.payment, { method: "CASH_ON_DELIVERY", amountDue: "3100.00", status: "PENDING" });
      assert.deepEqual(shopOrder.delivery, {
        recipientName: "Aïcha Mint Ahmed",
        deliveryPhone: "+22233000000",
        label: "Maison",
        city: "Nouakchott",
        district: "Tevragh Zeina",
        landmark: "Près de la mosquée bleue",
        latitude: 18.086,
        longitude: -15.975,
        locationSource: "MANUAL",
        accuracyMeters: null,
      });
      const [item] = shopOrder.items;
      assert.ok(item);
      assert.equal(item.productName, "Melhfa");
      assert.equal(item.unitPrice, "1500.00");
      assert.equal(item.quantity, 2);
      assert.equal(item.lineTotal, "3000.00");
      assert.ok(item.imageUrl?.startsWith(`${MEDIA_BASE_URL}/product-images/`));

      const row = await h.prisma.shopOrder.findUniqueOrThrow({ where: { id: shopOrder.id }, include: { statusEvents: true, payment: { include: { events: true } } } });
      assert.equal(row.remindAt.getTime() - row.createdAt.getTime(), 24 * 3_600_000);
      assert.deepEqual(
        row.statusEvents.map(({ fromStatus, toStatus, actorType, actorUserId }) => [fromStatus, toStatus, actorType, actorUserId]),
        [[null, "PENDING", "CUSTOMER", customer.userId]],
      );
      assert.deepEqual(
        row.payment?.events.map(({ type, amount, actorType }) => [type, amount?.toFixed(2), actorType]),
        [["CREATED", "3100.00", "CUSTOMER"]],
      );
      assert.equal((await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } })).stock, 3);
      const movements = await h.prisma.stockMovement.findMany();
      assert.deepEqual(
        movements.map(({ productId, variantId, quantity, type, applied }) => [productId, variantId, quantity, type, applied]),
        [[created.id, null, 2, "TAKEN", true]],
      );
      const notifications = await h.prisma.notification.findMany();
      assert.equal(notifications.length, 1);
      assert.equal(notifications[0]?.userId, seller.userId);
      assert.equal(notifications[0]?.type, "SHOP_ORDER_PLACED");
      assert.equal(notifications[0]?.eventKey, `SHOP_ORDER_PLACED:${shopOrder.id}:${seller.userId}`);
      assert.deepEqual([notifications[0]?.resourceType, notifications[0]?.resourceId, notifications[0]?.deliveredAt], ["SHOP_ORDER", shopOrder.id, null]);
      assert.deepEqual(notifications[0]?.payload, {
        orderReference: order.reference,
        shopOrderId: shopOrder.id,
        itemsCount: 2,
        total: "3100.00",
        respondBy: shopOrder.respondBy,
      });
      // The cart is emptied in the same transaction (D3).
      assert.equal(await h.prisma.cartItem.count(), 0);
    });

    it("splits a multi-shop checkout into independent shop orders, each with its own fee and payment", async () => {
      const first = await product({ price: "1000.00" });
      const second = await product({ name: "Voile", price: "500.00" });
      const other = await secondShop("50.00");
      const third = await product({ actor: other.actor, shop: other.shop, name: "Sandales", price: "800.00" });
      await add(first.id, 1);
      await add(second.id, 3);
      await add(third.id, 2);
      const order = await placed(await place(await bodyFromSummary()));

      assert.equal(order.total, "4250.00");
      const byShop = new Map(order.shopOrders.map((shopOrder) => [shopOrder.shop.id, shopOrder]));
      assert.equal(byShop.size, 2);
      // The fee is charged once per shop order, whatever the number of items.
      assert.deepEqual(
        [byShop.get(shopId)?.items.length, byShop.get(shopId)?.deliveryFee, byShop.get(shopId)?.payment.amountDue],
        [2, "100.00", "2600.00"],
      );
      assert.deepEqual([byShop.get(other.shop)?.deliveryFee, byShop.get(other.shop)?.payment.amountDue], ["50.00", "1650.00"]);
      assert.equal(await h.prisma.order.count(), 1);
      assert.equal(await h.prisma.payment.count(), 2);
      const notified = (await h.prisma.notification.findMany({ select: { userId: true } })).map(({ userId }) => userId).sort();
      assert.deepEqual(notified, [seller.userId, other.actor.userId].sort());
    });

    it("takes stock from the chosen variant", async () => {
      const created = await product({ stock: 0, variants: [{ size: "M", stock: 4 }, { size: "L", stock: 2 }] });
      const medium = created.variants.find(({ size }) => size === "M");
      assert.ok(medium);
      await add(created.id, 3, medium.id);
      const order = await placed(await place(await bodyFromSummary()));
      assert.equal(order.shopOrders[0]?.items[0]?.size, "M");
      const variants = await h.prisma.productVariant.findMany({ where: { productId: created.id }, orderBy: { size: "asc" } });
      assert.deepEqual(variants.map(({ size, stock }) => [size, stock]), [["L", 2], ["M", 1]]);
      assert.equal((await h.prisma.stockMovement.findFirstOrThrow()).variantId, medium.id);
    });

    it("stores the recipient name only on the order, and the profile phone when the address has none", async () => {
      const bare = await address(customer, { deliveryPhone: null, isDefault: false });
      const created = await product();
      await add(created.id, 1);
      const body = { ...(await bodyFromSummary()), addressId: bare, recipientName: "  Moussa Ba  " };
      const order = await placed(await place(body));
      assert.equal(order.shopOrders[0]?.delivery.recipientName, "Moussa Ba");
      assert.equal(order.shopOrders[0]?.delivery.deliveryPhone, "+22222111111");
      const profile = await h.prisma.customerProfile.findUniqueOrThrow({ where: { userId: customer.userId } });
      assert.equal(profile.fullName, "Aïcha Mint Ahmed");
      assert.equal((await h.prisma.customerAddress.findUniqueOrThrow({ where: { id: bare } })).deliveryPhone, null);
    });

    it("keeps every snapshot after the product, shop, address, and profile change or disappear", async () => {
      const created = await product({ price: "1500.00" });
      await add(created.id, 1);
      const key = randomUUID();
      const first = await placed(await place(await bodyFromSummary(), key));

      await h.call(`${sellerBase}/${created.id}`, seller.token, { method: "PATCH", body: { name: "Renamed", price: "9.00" } });
      await h.prisma.shop.update({ where: { id: shopId }, data: { deliveryFee: "999.00", contactPhone: "+22238888888", whatsappPhone: null, shopName: "New Name" } });
      await h.prisma.customerAddress.deleteMany({ where: { userId: customer.userId } });
      await h.prisma.customerProfile.update({ where: { userId: customer.userId }, data: { phone: "+22229999999" } });

      // A repeated key returns the stored order: it is read from the snapshots only.
      const again = await placed(await place({ addressId: randomUUID(), recipientName: "x", expected: { total: "1", shops: [{ shopId, productsSubtotal: "1", deliveryFee: "0" }] } }, key), 200);
      assert.deepEqual(again, first);
    });
  });

  describe("blocking problems refuse the whole checkout and write nothing (section 8)", () => {
    async function expectBlocked(body: unknown): Promise<void> {
      const before = await snapshot();
      await expectError(await place(body), 409, "CHECKOUT_BLOCKED");
      assert.deepEqual(await snapshot(), before);
    }

    it("a shop without a delivery fee", async () => {
      const created = await product();
      await add(created.id, 1);
      const body = await bodyFromSummary();
      await h.prisma.shop.update({ where: { id: shopId }, data: { deliveryFee: null } });
      await expectBlocked(body);
    });

    it("a product from a shop the customer owns, also in a multi-shop checkout and without reading the summary (O2)", async () => {
      const elsewhere = await product();
      await add(elsewhere.id, 1);
      const owner = await ownShop();
      const own = await product({ actor: customer, shop: owner.shopId, name: "Mon produit", price: "200.00" });
      await add(own.id, 1);
      // A client that skips the summary and sends correct figures is still refused.
      await expectBlocked({
        addressId,
        recipientName: "Aïcha",
        expected: {
          total: "1810.00",
          shops: [
            { shopId, productsSubtotal: "1500.00", deliveryFee: "100.00" },
            { shopId: owner.shopId, productsSubtotal: "200.00", deliveryFee: "10.00" },
          ],
        },
      });
    });

    it("an unaccepted price change, until the customer accepts it", async () => {
      const created = await product({ price: "100.00" });
      await add(created.id, 1);
      await h.call(`${sellerBase}/${created.id}`, seller.token, { method: "PATCH", body: { price: "120.00" } });
      const body = { addressId, recipientName: "Aïcha", expected: { total: "220.00", shops: [{ shopId, productsSubtotal: "120.00", deliveryFee: "100.00" }] } };
      await expectBlocked(body);
      const line = await h.prisma.cartItem.findFirstOrThrow();
      assert.equal((await post(`${cartPath}/items/${line.id}/accept-price`, customer, { price: "120.00" })).status, 200);
      await placed(await place(body));
    });

    it("a quantity above the stock", async () => {
      const created = await product({ stock: 3 });
      await add(created.id, 3);
      const body = await bodyFromSummary();
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 2 } });
      await expectBlocked(body);
    });

    it("an archived product, an unpublished product, a suspended shop, a removed variant", async () => {
      const archived = await product({ name: "A" });
      await add(archived.id, 1);
      const body = await bodyFromSummary();
      assert.equal((await post(`${sellerBase}/${archived.id}/archive`, seller)).status, 200);
      await expectBlocked(body);

      await h.prisma.cartItem.deleteMany();
      const hidden = await product({ name: "B" });
      await add(hidden.id, 1);
      await h.prisma.product.update({ where: { id: hidden.id }, data: { status: "DRAFT" } });
      await expectBlocked(await bodyFromSummary().catch(() => body));

      await h.prisma.cartItem.deleteMany();
      const variantProduct = await product({ name: "C", stock: 0, variants: [{ size: "M", stock: 2 }, { size: "L", stock: 2 }] });
      const medium = variantProduct.variants.find(({ size }) => size === "M");
      assert.ok(medium);
      await add(variantProduct.id, 1, medium.id);
      const variantBody = await bodyFromSummary();
      assert.equal((await h.call(`${sellerBase}/${variantProduct.id}/variants/${medium.id}`, seller.token, { method: "DELETE" })).status, 200);
      await expectBlocked(variantBody);

      await h.prisma.cartItem.deleteMany();
      const fine = await product({ name: "D" });
      await add(fine.id, 1);
      const suspendedBody = await bodyFromSummary();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      await expectBlocked(suspendedBody);
    });

    it("an empty cart (409 CHECKOUT_CART_EMPTY)", async () => {
      const body = { addressId, recipientName: "Aïcha", expected: { total: "0.00", shops: [{ shopId, productsSubtotal: "0.00", deliveryFee: "100.00" }] } };
      await expectError(await place(body), 409, "CHECKOUT_CART_EMPTY");
      const created = await product();
      await add(created.id, 1);
      await h.prisma.cartItem.deleteMany();
      await expectError(await place(body), 409, "CHECKOUT_CART_EMPTY");
      assert.equal(await h.prisma.order.count(), 0);
    });
  });

  describe("figures the customer was shown (section 7)", () => {
    async function expectChanged(body: unknown): Promise<void> {
      const before = await snapshot();
      await expectError(await place(body), 409, "CHECKOUT_TOTALS_CHANGED");
      assert.deepEqual(await snapshot(), before);
    }

    it("refuses any difference in a subtotal, a fee, the total, or the shops, and stores only server amounts", async () => {
      const created = await product({ price: "1500.00" });
      await add(created.id, 1);
      const other = await secondShop("50.00");
      const third = await product({ actor: other.actor, shop: other.shop, name: "Sandales", price: "800.00" });
      await add(third.id, 1);
      const body = await bodyFromSummary();
      const [mine, theirs] = body.expected.shops;
      assert.ok(mine && theirs);

      await expectChanged({ ...body, expected: { ...body.expected, total: "2449.99" } });
      await expectChanged({ ...body, expected: { ...body.expected, shops: [{ ...mine, deliveryFee: "0.00" }, theirs] } });
      await expectChanged({ ...body, expected: { ...body.expected, shops: [{ ...mine, productsSubtotal: "1400.00" }, theirs] } });
      await expectChanged({ ...body, expected: { ...body.expected, shops: [mine] } });
      await expectChanged({ ...body, expected: { ...body.expected, shops: [mine, theirs, { shopId: randomUUID(), productsSubtotal: "0", deliveryFee: "0" }] } });
      await expectChanged({ ...body, expected: { ...body.expected, shops: [mine, mine] } });

      const order = await placed(await place(body));
      assert.equal(order.total, "2450.00");
    });

    it("refuses a fee changed by the seller after the summary was shown", async () => {
      const created = await product();
      await add(created.id, 1);
      const body = await bodyFromSummary();
      assert.equal((await h.call("/sellers/me/shop", seller.token, { method: "PATCH", body: { deliveryFee: "150" } })).status, 200);
      await expectChanged(body);
      const fresh = await placed(await place(await bodyFromSummary()));
      assert.equal(fresh.shopOrders[0]?.deliveryFee, "150.00");
    });

    it("accepts free delivery (0.00)", async () => {
      await h.prisma.shop.update({ where: { id: shopId }, data: { deliveryFee: "0.00" } });
      const created = await product({ price: "300.00" });
      await add(created.id, 1);
      const order = await placed(await place(await bodyFromSummary()));
      assert.deepEqual([order.deliveryFeeTotal, order.total], ["0.00", "300.00"]);
    });
  });

  describe("integrity (section 9)", () => {
    it("requires a UUID Idempotency-Key", async () => {
      const created = await product();
      await add(created.id, 1);
      const body = await bodyFromSummary();
      await expectError(await place(body, null), 400, "CHECKOUT_IDEMPOTENCY_KEY_INVALID");
      await expectError(await place(body, "not-a-uuid"), 400, "CHECKOUT_IDEMPOTENCY_KEY_INVALID");
      await expectError(await place({ ...body, recipientName: "" }), 400, "BAD_REQUEST");
      assert.equal(await h.prisma.order.count(), 0);
    });

    it("returns the same order for a repeated key and writes nothing; a new key then finds the cart empty", async () => {
      const created = await product({ stock: 5 });
      await add(created.id, 2);
      const body = await bodyFromSummary();
      const key = randomUUID();
      const first = await placed(await place(body, key));
      const before = await snapshot();
      const second = await placed(await place(body, key.toUpperCase()), 200);
      assert.deepEqual(second, first);
      assert.deepEqual(await snapshot(), before);
      await expectError(await place(body), 409, "CHECKOUT_CART_EMPTY");
      assert.equal((await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } })).stock, 3);
    });

    it("keys are per customer: another customer's key never returns their order", async () => {
      const created = await product();
      await add(created.id, 1);
      const key = randomUUID();
      await placed(await place(await bodyFromSummary(), key));
      const other = await h.actor();
      const otherAddress = await address(other);
      await add(created.id, 1, undefined, other);
      const theirs = await placed(await place({ ...(await bodyFromSummary(other)), addressId: otherAddress }, key, other));
      assert.equal(await h.prisma.order.count(), 2);
      assert.equal((await h.prisma.order.findUniqueOrThrow({ where: { id: theirs.id } })).userId, other.userId);
    });

    it("creates one order for concurrent requests with the same key", async () => {
      const created = await product({ stock: 10 });
      await add(created.id, 2);
      const body = await bodyFromSummary();
      const key = randomUUID();
      const responses = await Promise.all(Array.from({ length: 4 }, () => place(body, key)));
      const statuses = responses.map(({ status }) => status).sort();
      assert.deepEqual(statuses, [200, 200, 200, 201]);
      const orders = await Promise.all(responses.map((response) => response.json() as Promise<CustomerOrder>));
      assert.equal(new Set(orders.map(({ id }) => id)).size, 1);
      assert.equal(await h.prisma.order.count(), 1);
      assert.equal(await h.prisma.payment.count(), 1);
      assert.equal((await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } })).stock, 8);
    });

    it("never oversells: concurrent checkouts of the last units succeed only while stock remains", async () => {
      const created = await product({ stock: 3 });
      const buyers = await Promise.all(Array.from({ length: 4 }, () => h.actor()));
      const bodies: unknown[] = [];
      for (const buyer of buyers) {
        const buyerAddress = await address(buyer);
        await add(created.id, 1, undefined, buyer);
        bodies.push({ ...(await bodyFromSummary(buyer)), addressId: buyerAddress });
      }
      const responses = await Promise.all(buyers.map((buyer, index) => place(bodies[index], randomUUID(), buyer)));
      const statuses = responses.map(({ status }) => status).sort();
      assert.deepEqual(statuses, [201, 201, 201, 409]);
      assert.equal((await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } })).stock, 0);
      assert.equal(await h.prisma.stockMovement.count(), 3);
    });

    it("never oversells across two shops placed at once by different customers (no deadlock)", async () => {
      const mine = await product({ stock: 1 });
      const other = await secondShop("10.00");
      const theirs = await product({ actor: other.actor, shop: other.shop, name: "Sandales", stock: 1 });
      const [a, b] = [await h.actor(), await h.actor()];
      const bodies: unknown[] = [];
      for (const [buyer, order] of [
        [a, [mine, theirs]],
        [b, [theirs, mine]],
      ] as const) {
        const buyerAddress = await address(buyer);
        for (const item of order) await add(item.id, 1, undefined, buyer);
        bodies.push({ ...(await bodyFromSummary(buyer)), addressId: buyerAddress });
      }
      const responses = await Promise.all([place(bodies[0], randomUUID(), a), place(bodies[1], randomUUID(), b)]);
      assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
      const stock = await h.prisma.product.findMany({ where: { id: { in: [mine.id, theirs.id] } }, select: { stock: true } });
      assert.deepEqual(stock.map(({ stock: value }) => value), [0, 0]);
    });

    it("re-checks stock and prices under the locks, not from an earlier read", async () => {
      const created = await product({ stock: 2, price: "100.00" });
      await add(created.id, 2);
      const body = await bodyFromSummary();
      // Changes committed after the summary are seen by the validation under the locks.
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 1 } });
      await expectError(await place(body), 409, "CHECKOUT_BLOCKED");
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 2, price: "90.00" } });
      await expectError(await place(body), 409, "CHECKOUT_BLOCKED");
    });

    it("rolls everything back when a step fails: no order, stock, payment, notification, or removed cart line", async () => {
      const created = await product({ stock: 5 });
      await add(created.id, 2);
      const other = await secondShop("50.00");
      const third = await product({ actor: other.actor, shop: other.shop, name: "Sandales" });
      await add(third.id, 1);
      const body = await bodyFromSummary();
      const before = await snapshot();
      h.faults.checkout.beforeCommit = () => {
        throw new Error("injected failure");
      };
      assert.equal((await place(body)).status, 500);
      assert.deepEqual(await snapshot(), before);
      delete h.faults.checkout.beforeCommit;
      await placed(await place(body));
    });

    it("rate-limits placement per user, with the configured defaults", async () => {
      assert.deepEqual(CHECKOUT_RATE_LIMIT, { perUser: 20, perIp: 60, windowMs: 600_000 });
      for (let attempt = 0; attempt < 20; attempt += 1) assert.equal((await place({}, null)).status, 400);
      assert.equal((await place({}, null)).status, 429);
      // Reads follow the cart's rules and are not limited by placement.
      assert.equal((await h.call(checkoutPath, customer.token)).status, 200);
      // Another customer has their own counter.
      const other = await h.actor();
      assert.equal((await place({}, null, other)).status, 400);
    });
  });

  describe("delivery fee setting (spec 06, D2)", () => {
    const shopPath = "/sellers/me/shop";

    it("is null until set, can be set and changed (audited), never cleared, and refused on a suspended shop", async () => {
      const { owner, shopId: fresh } = await h.shopInStatus("APPROVED");
      const read = async () => (await (await h.call(shopPath, owner.token)).json()) as OwnerShopResponse;
      assert.equal((await read()).deliveryFee, null);

      const patch = (body: unknown) => h.call(shopPath, owner.token, { method: "PATCH", body });
      assert.equal((await patch({ deliveryFee: "150" })).status, 200);
      assert.equal((await read()).deliveryFee, "150.00");
      assert.equal((await patch({ deliveryFee: "0" })).status, 200);
      assert.equal((await read()).deliveryFee, "0.00");
      for (const deliveryFee of [null, "-1", 150, "1.999"]) assert.equal((await patch({ deliveryFee })).status, 400, String(deliveryFee));
      assert.equal((await read()).deliveryFee, "0.00");

      const changes = await h.prisma.shopFieldChangeEvent.findMany({ where: { shopId: fresh, field: "deliveryFee" }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(
        changes.map(({ oldValue, newValue, source, actorUserId }) => [oldValue, newValue, source, actorUserId]),
        [
          [null, "150.00", "OWNER_UPDATE", owner.userId],
          ["150.00", "0.00", "OWNER_UPDATE", owner.userId],
        ],
      );
      // Setting the same value again records nothing.
      assert.equal((await patch({ deliveryFee: "0.00" })).status, 200);
      assert.equal(await h.prisma.shopFieldChangeEvent.count({ where: { shopId: fresh, field: "deliveryFee" } }), 2);

      await h.prisma.shop.update({ where: { id: fresh }, data: { status: "SUSPENDED" } });
      assert.equal((await patch({ deliveryFee: "10" })).status, 403);
    });

    it("never changes an existing order (snapshot)", async () => {
      const created = await product();
      await add(created.id, 1);
      const key = randomUUID();
      await placed(await place(await bodyFromSummary(), key));
      assert.equal((await h.call(shopPath, seller.token, { method: "PATCH", body: { deliveryFee: "500" } })).status, 200);
      const row = await h.prisma.shopOrder.findFirstOrThrow();
      assert.equal(row.deliveryFee.toFixed(2), "100.00");
    });
  });

  describe("snapshotted images (S2-7)", () => {
    it("the image cleanup never deletes an image an order references", async () => {
      const created = await product();
      await add(created.id, 1);
      const order = await placed(await place(await bodyFromSummary()));
      const imageUrl = order.shopOrders[0]?.items[0]?.imageUrl;
      assert.ok(imageUrl);
      const key = imageUrl.slice(MEDIA_BASE_URL.length + 1);

      // The seller replaces the image: the ordered one is released.
      await uploadImage(seller, shopId, created.id);
      const ordered = await h.prisma.productImage.findFirstOrThrow({ where: { objectKey: key } });
      assert.equal((await h.call(`${sellerBase}/${created.id}/images/${ordered.id}`, seller.token, { method: "DELETE" })).status, 200);
      assert.equal((await h.prisma.productImage.findUniqueOrThrow({ where: { id: ordered.id } })).status, "RELEASED");

      await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
      assert.ok(h.storage.media.has(key), "the ordered image is kept");
      assert.equal(h.storage.mediaDeletes.includes(key), false);
      assert.equal((await h.prisma.productImage.findUniqueOrThrow({ where: { id: ordered.id } })).status, "RELEASED");
    });
  });
});
