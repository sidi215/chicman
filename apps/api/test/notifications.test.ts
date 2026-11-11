import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  NOTIFICATION_LIST_MAX_LIMIT,
  NOTIFICATION_TYPES,
  notificationListQuerySchema,
  type NotificationItem,
  type NotificationList,
  type NotificationUnreadCount,
} from "@chicman/shared";
import dotenv from "dotenv";

import { Prisma } from "../src/generated/prisma/client.js";
import {
  CONFIGURED_NOTIFICATION_CHANNELS,
  NOTIFICATION_RETENTION_DAYS,
  notificationRetentionCutoff,
  purgeExpiredNotifications,
  recordNotification,
  recordShopOrderPlaced,
} from "../src/modules/notifications/index.js";
import { createOrder } from "../src/modules/orders/index.js";
import { createPayment } from "../src/modules/payments/index.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("notification contract (spec 15)", () => {
  it("lists every type of section 5 once", () => {
    assert.equal(new Set(NOTIFICATION_TYPES).size, NOTIFICATION_TYPES.length);
    assert.equal(NOTIFICATION_TYPES.length, 16);
  });

  it("bounds the page size and refuses unknown parameters", () => {
    assert.equal(notificationListQuerySchema.parse({}).limit, 20);
    assert.equal(notificationListQuerySchema.safeParse({ limit: String(NOTIFICATION_LIST_MAX_LIMIT) }).success, true);
    for (const query of [{ limit: "51" }, { limit: "0" }, { limit: "x" }, { audience: "SELLER" }, { userId: randomUUID() }]) {
      assert.equal(notificationListQuerySchema.safeParse(query).success, false, JSON.stringify(query));
    }
  });

  it("configures no external delivery channel", () => {
    assert.equal(CONFIGURED_NOTIFICATION_CHANNELS.length, 0);
  });

  it("keeps notifications 365 days (O6.3)", () => {
    assert.equal(NOTIFICATION_RETENTION_DAYS, 365);
    const now = new Date("2027-11-11T12:00:00.000Z");
    assert.equal(notificationRetentionCutoff(now).toISOString(), "2026-11-11T12:00:00.000Z");
  });
});

describe("notifications (spec 15, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let customer: Actor;
  let stranger: Actor;
  let admin: Actor;

  const INTERNAL_REASON = "Fraude signalée par téléphone, référence interne 77";
  const INTERNAL_NOTE = "Note interne très confidentielle";
  const base = "/customers/me/notifications";

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: shopId }, data: { shopName: "Boutique Alpha", deliveryFee: "100.00" } });
    customer = await h.actor();
    stranger = await h.actor();
    admin = await h.actor(["CUSTOMER", "ADMIN"]);
  });

  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", ...(body === undefined ? {} : { body }) });

  async function list(actor: Actor, query = ""): Promise<NotificationList> {
    const response = await h.call(`${base}${query}`, actor.token);
    assert.equal(response.status, 200);
    return (await response.json()) as NotificationList;
  }

  async function unread(actor: Actor, query = ""): Promise<number> {
    const response = await h.call(`${base}/unread-count${query}`, actor.token);
    assert.equal(response.status, 200);
    return ((await response.json()) as NotificationUnreadCount).unread;
  }

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  /** Places a one-shop order as checkout does (spec 10), with the seller's `SHOP_ORDER_PLACED`. */
  async function placeOrder() {
    const product = await h.prisma.product.create({
      data: { shopId, name: "Melhfa", description: "Voile léger.", category: "CLOTHING", price: "1500.00", stock: 10, status: "PUBLISHED", publishedAt: new Date() },
    });
    return h.prisma.$transaction(async (tx) => {
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
            shopId,
            shopName: "Boutique Alpha",
            contactPhone: "+22246000000",
            whatsappPhone: null,
            deliveryFee: new Prisma.Decimal("100.00"),
            items: [
              {
                productId: product.id,
                variantId: null,
                productName: product.name,
                size: null,
                color: null,
                imageObjectKey: `product-images/${shopId}/${product.id}/image.webp`,
                unitPrice: product.price,
                quantity: 1,
              },
            ],
          },
        ],
      });
      const [shopOrder] = order.shopOrders;
      assert.ok(shopOrder);
      await createPayment(tx, { shopOrderId: shopOrder.id, amountDue: shopOrder.total, customerUserId: customer.userId });
      await recordShopOrderPlaced(tx, {
        sellerUserId: seller.userId,
        orderReference: order.reference,
        shopOrderId: shopOrder.id,
        itemsCount: shopOrder.itemsCount,
        total: shopOrder.total,
        respondBy: shopOrder.respondBy,
      });
      return { orderId: order.id, reference: order.reference, shopOrderId: shopOrder.id };
    });
  }

  /** Records `count` notifications for `actor`, one millisecond apart, oldest first. */
  async function seed(actor: Actor, count: number, at = Date.now() - 60_000): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const row = await h.prisma.notification.create({
        data: {
          userId: actor.userId,
          type: "SHOP_ORDER_CONFIRMED",
          payload: { orderReference: `CM-${index}`, shopName: "Boutique Alpha" },
          eventKey: `SHOP_ORDER_CONFIRMED:${randomUUID()}:${actor.userId}`,
          createdAt: new Date(at + index),
        },
      });
      ids.push(row.id);
    }
    return ids;
  }

  describe("access", () => {
    it("requires a session on every route", async () => {
      for (const [path, method] of [
        [base, "GET"],
        [`${base}/unread-count`, "GET"],
        [`${base}/read-all`, "POST"],
        [`${base}/${randomUUID()}/read`, "POST"],
      ] as const) {
        assert.equal((await h.call(path, null, { method })).status, 401, path);
      }
    });

    it("never reads, counts, or changes another user's notifications (404)", async () => {
      const [theirs] = await seed(stranger, 1);
      assert.ok(theirs);
      await seed(customer, 2);
      assert.equal((await list(customer)).items.length, 2);
      assert.equal(await unread(customer), 2);
      await expectError(await post(`${base}/${theirs}/read`, customer), 404, "NOTIFICATION_NOT_FOUND");
      await expectError(await post(`${base}/not-a-uuid/read`, customer), 404, "NOTIFICATION_NOT_FOUND");
      await expectError(await post(`${base}/${randomUUID()}/read`, customer), 404, "NOTIFICATION_NOT_FOUND");
      assert.equal((await post(`${base}/read-all`, customer)).status, 204);
      const row = await h.prisma.notification.findUniqueOrThrow({ where: { id: theirs } });
      assert.equal(row.readAt, null, "the stranger's notification stays unread");
      assert.equal(await unread(stranger), 1);
      assert.equal(await unread(customer), 0);
    });

    it("refuses a malformed query or cursor (400)", async () => {
      for (const query of ["?limit=51", "?limit=0", "?audience=SELLER", "?userId=x", "?cursor=bm9wZQ", `?cursor=${Buffer.from("2026-01-01T00:00:00.000Z|x").toString("base64url")}`]) {
        await expectError(await h.call(`${base}${query}`, customer.token), 400, "BAD_REQUEST");
      }
      await expectError(await h.call(`${base}/unread-count?audience=ADMIN`, customer.token), 400, "BAD_REQUEST");
    });
  });

  describe("listing", () => {
    it("lists newest first, page by page on (createdAt, id), with no gap or repeat", async () => {
      const ids = await seed(customer, 7);
      // Two rows with the same time: the ID breaks the tie.
      const same = new Date(Date.now() - 30_000);
      const twins = await Promise.all(
        [0, 1].map(async () =>
          (
            await h.prisma.notification.create({
              data: { userId: customer.userId, type: "SHOP_ORDER_EXPIRED", payload: { orderReference: "CM-T", shopName: "Boutique Alpha" }, createdAt: same },
            })
          ).id,
        ),
      );
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page: NotificationList = await list(customer, `?limit=3${cursor === null ? "" : `&cursor=${cursor}`}`);
        assert.ok(page.items.length <= 3);
        seen.push(...page.items.map(({ id }) => id));
        cursor = page.nextCursor;
        pages += 1;
      } while (cursor !== null);
      assert.equal(pages, 3);
      assert.deepEqual(seen, [...twins.sort().reverse(), ...[...ids].reverse()]);
    });

    it("answers with the allowlisted item only: no recipient, event key, or delivery state", async () => {
      await seed(customer, 1);
      const [item] = (await list(customer)).items;
      assert.ok(item);
      assert.deepEqual(Object.keys(item).sort(), ["audience", "createdAt", "id", "payload", "readAt", "resource", "type"]);
      assert.equal(item.readAt, null);
    });
  });

  describe("read state", () => {
    it("marks one read, idempotently, keeping the first read time; read-all is idempotent", async () => {
      const [first, second] = await seed(customer, 3);
      assert.ok(first && second);
      assert.equal(await unread(customer), 3);
      assert.equal((await post(`${base}/${first}/read`, customer)).status, 204);
      const readAt = (await h.prisma.notification.findUniqueOrThrow({ where: { id: first } })).readAt;
      assert.ok(readAt);
      assert.equal((await post(`${base}/${first}/read`, customer)).status, 204);
      assert.deepEqual((await h.prisma.notification.findUniqueOrThrow({ where: { id: first } })).readAt, readAt);
      assert.equal(await unread(customer), 2);
      const listed = (await list(customer)).items.find(({ id }) => id === first);
      assert.equal(listed?.readAt, readAt.toISOString());

      assert.equal((await post(`${base}/read-all`, customer)).status, 204);
      assert.equal((await post(`${base}/read-all`, customer)).status, 204);
      assert.equal(await unread(customer), 0);
      assert.deepEqual((await h.prisma.notification.findUniqueOrThrow({ where: { id: first } })).readAt, readAt);
      // Reading is not delivery.
      assert.equal(await h.prisma.notification.count({ where: { deliveredAt: { not: null } } }), 0);
    });

    it("limits the read writes per user", async () => {
      const [id] = await seed(customer, 1);
      h.notificationRateLimiter = { hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }) };
      await expectError(await post(`${base}/${id}/read`, customer), 429, "RATE_LIMITED");
      await expectError(await post(`${base}/read-all`, customer), 429, "RATE_LIMITED");
    });
  });

  describe("order notifications, audiences, and resources", () => {
    it("addresses each party, links the customer to the order, and narrows to customer order notifications", async () => {
      const placed = await placeOrder();
      // The administrator cancels: both parties are told, with no internal reason.
      const cancelled = await post(`/admin/orders/${placed.shopOrderId}/cancel`, admin, { internalReason: INTERNAL_REASON, internalNote: INTERNAL_NOTE });
      assert.equal(cancelled.status, 200);

      const sellerItems = (await list(seller)).items;
      assert.deepEqual(sellerItems.map(({ type }) => type), ["SHOP_ORDER_CANCELLED", "SHOP_ORDER_PLACED"]);
      for (const item of sellerItems) {
        assert.equal(item.audience, "SELLER");
        assert.deepEqual(item.resource, { type: "SHOP_ORDER", id: placed.shopOrderId, orderId: null });
      }

      const customerItems = (await list(customer)).items;
      assert.equal(customerItems.length, 1);
      const [notice] = customerItems as Extract<NotificationItem, { type: "SHOP_ORDER_CANCELLED" }>[];
      assert.equal(notice?.type, "SHOP_ORDER_CANCELLED");
      assert.equal(notice?.audience, "CUSTOMER");
      assert.deepEqual(notice?.resource, { type: "SHOP_ORDER", id: placed.shopOrderId, orderId: placed.orderId });
      assert.deepEqual(notice?.payload, { orderReference: placed.reference, shopName: "Boutique Alpha", cancelledBy: "CHICMAN", reasonCode: null });
      for (const items of [sellerItems, customerItems]) {
        const text = JSON.stringify(items);
        assert.equal(text.includes(INTERNAL_REASON) || text.includes(INTERNAL_NOTE) || text.includes(admin.userId), false);
      }

      // `audience=CUSTOMER`: the seller's own order notifications are not customer ones.
      assert.equal((await list(seller, "?audience=CUSTOMER")).items.length, 0);
      assert.equal(await unread(seller, "?audience=CUSTOMER"), 0);
      assert.equal(await unread(seller), 2);
      assert.equal((await list(customer, "?audience=CUSTOMER")).items.length, 1);
      assert.equal(await unread(customer, "?audience=CUSTOMER"), 1);

      // Read-all in the customer scope leaves the seller's notifications alone.
      assert.equal((await post(`${base}/read-all?audience=CUSTOMER`, seller)).status, 204);
      assert.equal(await unread(seller), 2);
      assert.equal((await post(`${base}/read-all?audience=CUSTOMER`, customer)).status, 204);
      assert.equal(await unread(customer), 0);
    });

    it("a shop decision reaches the owner as a seller, pointing at the shop", async () => {
      const { owner, shopId: pending } = await h.shopInStatus("PENDING");
      const approved = await post(`/admin/shops/${pending}/approve`, admin, { internalReason: INTERNAL_REASON, internalNote: INTERNAL_NOTE });
      assert.equal(approved.status, 200);
      const [item] = (await list(owner)).items;
      assert.equal(item?.type, "SHOP_APPLICATION_APPROVED");
      assert.equal(item?.audience, "SELLER");
      assert.deepEqual(item?.resource, { type: "SHOP", id: pending });
      assert.equal(JSON.stringify(item).includes(INTERNAL_REASON), false);
      assert.equal((await list(owner, "?audience=CUSTOMER")).items.length, 0);
    });

    it("a row recorded before resource references lists with no resource", async () => {
      await h.prisma.notification.create({
        data: { userId: seller.userId, type: "SHOP_SUSPENDED", payload: { shopName: "Boutique Alpha", shopStatus: "SUSPENDED", decidedAt: new Date().toISOString() } },
      });
      const [item] = (await list(seller)).items;
      assert.equal(item?.resource, null);
      assert.equal(item?.audience, "SELLER");
    });
  });

  describe("recording", () => {
    it("records an event once, whatever the retries", async () => {
      const sourceId = randomUUID();
      const record = () =>
        h.prisma.$transaction((tx) =>
          recordNotification(tx, { recipientUserId: customer.userId, type: "SHOP_ORDER_CONFIRMED", payload: { orderReference: "CM-1", shopName: "A" }, sourceId }),
        );
      await record();
      await record();
      await Promise.all([record(), record()]);
      assert.equal(await h.prisma.notification.count(), 1);
    });

    it("a rolled-back change leaves no notification", async () => {
      await assert.rejects(
        h.prisma.$transaction(async (tx) => {
          await recordNotification(tx, { recipientUserId: customer.userId, type: "SHOP_ORDER_CONFIRMED", payload: { orderReference: "CM-1", shopName: "A" }, sourceId: randomUUID() });
          throw new Error("rollback");
        }),
      );
      assert.equal(await h.prisma.notification.count(), 0);
      assert.equal(await unread(customer), 0);
    });
  });

  describe("retention (O6.3)", () => {
    const DAY = 24 * 60 * 60_000;
    const NOW = new Date();
    const ago = (days: number, extraMs = 0) => new Date(NOW.getTime() - days * DAY + extraMs);

    /** Records one event through the normal path, then dates its notification. */
    async function recordAt(createdAt: Date, sourceId = randomUUID(), read = false) {
      await h.prisma.$transaction((tx) =>
        recordNotification(tx, { recipientUserId: customer.userId, type: "SHOP_ORDER_CONFIRMED", payload: { orderReference: "CM-1", shopName: "A" }, sourceId }),
      );
      const key = `SHOP_ORDER_CONFIRMED:${sourceId}:${customer.userId}`;
      await h.prisma.notification.update({ where: { eventKey: key }, data: { createdAt, readAt: read ? createdAt : null } });
      return { sourceId, key };
    }

    it("deletes notifications older than 365 days, read or unread, and keeps the rest", async () => {
      const old = await recordAt(ago(366));
      const oldRead = await recordAt(ago(400), randomUUID(), true);
      const boundary = await recordAt(ago(365));
      const recent = await recordAt(ago(364));
      // Recorded before event keys existed: deleted the same way.
      await h.prisma.notification.create({ data: { userId: customer.userId, type: "SHOP_SUSPENDED", payload: {}, createdAt: ago(500) } });

      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW }), 3);
      const left = await h.prisma.notification.findMany({ select: { eventKey: true } });
      assert.deepEqual(left.map(({ eventKey }) => eventKey).sort(), [boundary.key, recent.key].sort());
      // The ledger keeps every key.
      const ledger = await h.prisma.notificationEvent.findMany({ select: { eventKey: true } });
      assert.deepEqual(ledger.map(({ eventKey }) => eventKey).sort(), [old.key, oldRead.key, boundary.key, recent.key].sort());
    });

    it("is idempotent and safe to run concurrently", async () => {
      for (let index = 0; index < 5; index += 1) await recordAt(ago(370));
      const runs = await Promise.all([purgeExpiredNotifications(h.prisma, { now: NOW }), purgeExpiredNotifications(h.prisma, { now: NOW })]);
      assert.equal(runs[0] + runs[1], 5);
      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW }), 0);
      assert.equal(await h.prisma.notification.count(), 0);
    });

    it("works in bounded batches; a backlog is finished by later runs", async () => {
      for (let index = 0; index < 5; index += 1) await recordAt(ago(370, index));
      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW, batchSize: 2, maxBatches: 2 }), 4);
      assert.equal(await h.prisma.notification.count(), 1);
      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW, batchSize: 2, maxBatches: 2 }), 1);
      assert.equal(await h.prisma.notification.count(), 0);
    });

    it("never records a deleted notification's event again", async () => {
      const { sourceId } = await recordAt(ago(400));
      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW }), 1);
      await h.prisma.$transaction((tx) =>
        recordNotification(tx, { recipientUserId: customer.userId, type: "SHOP_ORDER_CONFIRMED", payload: { orderReference: "CM-1", shopName: "A" }, sourceId }),
      );
      assert.equal(await h.prisma.notification.count(), 0);
      assert.equal(await h.prisma.notificationEvent.count(), 1);
    });

    it("never reminds a seller again after the reminder's notification is deleted", async () => {
      const placed = await placeOrder();
      await h.prisma.shopOrder.update({ where: { id: placed.shopOrderId }, data: { remindAt: new Date(Date.now() - 60_000) } });
      assert.equal((await h.orderLifecycle.remindDue()).done, 1);
      const reminder = await h.prisma.notification.findFirstOrThrow({ where: { type: "SHOP_ORDER_RESPONSE_REMINDER" } });
      await h.prisma.notification.update({ where: { id: reminder.id }, data: { createdAt: ago(400) } });
      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW }), 1);
      assert.equal((await h.orderLifecycle.remindDue()).done, 0);
      assert.equal(await h.prisma.notification.count({ where: { type: "SHOP_ORDER_RESPONSE_REMINDER" } }), 0);
    });

    it("deletes notification records only, never business records", async () => {
      const placed = await placeOrder();
      assert.equal((await post(`/admin/orders/${placed.shopOrderId}/cancel`, admin, { internalReason: INTERNAL_REASON })).status, 200);
      const snapshot = async () => ({
        orders: await h.prisma.order.findMany({ orderBy: { id: "asc" } }),
        shopOrders: await h.prisma.shopOrder.findMany({ orderBy: { id: "asc" } }),
        items: await h.prisma.orderItem.findMany({ orderBy: { id: "asc" } }),
        statusEvents: await h.prisma.shopOrderStatusEvent.findMany({ orderBy: { id: "asc" } }),
        stock: await h.prisma.stockMovement.findMany({ orderBy: { id: "asc" } }),
        payments: await h.prisma.payment.findMany({ orderBy: { id: "asc" } }),
        paymentEvents: await h.prisma.paymentEvent.findMany({ orderBy: { id: "asc" } }),
        deliveries: await h.prisma.delivery.findMany({ orderBy: { id: "asc" } }),
        products: await h.prisma.product.findMany({ orderBy: { id: "asc" } }),
        ledger: await h.prisma.notificationEvent.findMany({ orderBy: { eventKey: "asc" } }),
      });
      const before = await snapshot();
      await h.prisma.notification.updateMany({ data: { createdAt: ago(400) } });
      assert.equal(await purgeExpiredNotifications(h.prisma, { now: NOW }), 3);
      assert.deepEqual(await snapshot(), before);
    });
  });
});
