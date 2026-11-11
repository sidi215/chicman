import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { FAVORITES_MAX_ITEMS, type Cart, type FavoriteItem, type FavoriteList, type SellerProductDetail } from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { MEDIA_BASE_URL, ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("favorites (spec 14, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let customer: Actor;
  let tiny: Buffer;

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
    customer = await h.actor();
  });

  const sellerBase = "/sellers/me/products";
  const favoritesPath = "/customers/me/favorites";
  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", body });
  const put = (productId: string, actor: Actor = customer) => h.call(`${favoritesPath}/${productId}`, actor.token, { method: "PUT" });
  const remove = (productId: string, actor: Actor = customer) => h.call(`${favoritesPath}/${productId}`, actor.token, { method: "DELETE" });

  interface Spec {
    name?: string;
    price?: string;
    stock?: number;
    actor?: Actor;
    shop?: string;
    publish?: boolean;
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
    const upload = await post(`${sellerBase}/${id}/images/uploads`, actor, { contentType: "image/png", contentLength: tiny.byteLength });
    assert.equal(upload.status, 201);
    const { uploadId } = (await upload.json()) as { uploadId: string };
    h.storage.staging.set(`product-images/${shop}/${id}/${uploadId}`, tiny);
    assert.equal((await post(`${sellerBase}/${id}/images/uploads/${uploadId}/complete`, actor)).status, 200);
    if (spec.publish !== false) assert.equal((await post(`${sellerBase}/${id}/publish`, actor)).status, 200);
    return (await (await h.call(`${sellerBase}/${id}`, actor.token)).json()) as SellerProductDetail;
  }

  async function ok(response: Response): Promise<FavoriteList> {
    assert.equal(response.status, 200);
    return (await response.json()) as FavoriteList;
  }
  const read = async (actor: Actor = customer) => ok(await h.call(favoritesPath, actor.token));
  const only = (list: FavoriteList): FavoriteItem => {
    assert.equal(list.items.length, 1);
    const item = list.items[0];
    assert.ok(item);
    return item;
  };
  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  describe("authorization and ownership", () => {
    it("requires a signed-in, bootstrapped user on every route", async () => {
      const id = randomUUID();
      for (const [method, path] of [
        ["GET", favoritesPath],
        ["PUT", `${favoritesPath}/${id}`],
        ["DELETE", `${favoritesPath}/${id}`],
      ] as const) {
        assert.equal((await h.call(path, null, { method })).status, 401, `${method} ${path}`);
      }
    });

    it("ties the list to the authenticated user: another customer can neither see nor change it", async () => {
      const created = await product();
      await ok(await put(created.id));
      const other = await h.actor();
      assert.deepEqual(await read(other), { items: [] });
      // Removing "the same" product only touches the caller's own list.
      assert.deepEqual(await ok(await remove(created.id, other)), { items: [] });
      assert.equal(only(await read()).productId, created.id);
      // Adding it to their own list does not share a row with the first customer.
      await ok(await put(created.id, other));
      assert.equal(await h.prisma.favorite.count({ where: { userId: customer.userId } }), 1);
      assert.equal(await h.prisma.favorite.count({ where: { userId: other.userId } }), 1);
    });

    it("never accepts a customer ID from the request", async () => {
      const created = await product();
      const other = await h.actor();
      // A body or a query naming another user is ignored: the token decides.
      const response = await h.call(`${favoritesPath}/${created.id}?userId=${other.userId}`, customer.token, {
        method: "PUT",
        body: { userId: other.userId },
      });
      await ok(response);
      assert.equal(await h.prisma.favorite.count({ where: { userId: other.userId } }), 0);
      assert.equal(await h.prisma.favorite.count({ where: { userId: customer.userId } }), 1);
    });

    it("persists across sessions, under the application user", async () => {
      const created = await product();
      await ok(await put(created.id));
      const nextSession = await h.newSession(customer);
      assert.notEqual(nextSession.token, customer.token);
      assert.equal(only(await read(nextSession)).productId, created.id);
    });

    it("rate-limits writes per user, not reads", async () => {
      const created = await product();
      h.favoriteRateLimiter = { hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }) };
      assert.equal((await put(created.id)).status, 429);
      assert.equal((await remove(created.id)).status, 429);
      assert.equal((await h.call(favoritesPath, customer.token)).status, 200);
    });
  });

  describe("adding and removing", () => {
    it("starts empty", async () => {
      assert.deepEqual(await read(), { items: [] });
    });

    it("adds a product with its current public card", async () => {
      const created = await product({ price: "1500.50" });
      const item = only(await ok(await put(created.id)));
      assert.equal(item.productId, created.id);
      assert.equal(item.name, "Melhfa");
      assert.equal(item.state, "AVAILABLE");
      assert.ok(item.imageUrl?.startsWith(`${MEDIA_BASE_URL}/`));
      assert.ok(!Number.isNaN(Date.parse(item.addedAt)));
      assert.deepEqual(item.product, {
        id: created.id,
        name: "Melhfa",
        category: "CLOTHING",
        brand: null,
        price: "1500.50",
        available: true,
        mainImageUrl: item.imageUrl,
        shop: { id: shopId, name: "Boutique Test" },
      });
      // No stock figure is ever exposed.
      assert.equal(JSON.stringify(item).includes('"stock"'), false);
    });

    it("does not create duplicates on repeated or concurrent adds", async () => {
      const created = await product();
      await ok(await put(created.id));
      await ok(await put(created.id));
      const responses = await Promise.all(Array.from({ length: 5 }, () => put(created.id)));
      for (const response of responses) assert.equal(response.status, 200);
      assert.equal(only(await read()).productId, created.id);
      assert.equal(await h.prisma.favorite.count(), 1);
    });

    it("keeps the original date on a repeated add", async () => {
      const created = await product();
      const first = only(await ok(await put(created.id)));
      const again = only(await ok(await put(created.id)));
      assert.equal(again.addedAt, first.addedAt);
    });

    it("lists the most recently added first", async () => {
      const first = await product({ name: "Premier" });
      const second = await product({ name: "Second" });
      await ok(await put(first.id));
      const list = await ok(await put(second.id));
      assert.deepEqual(
        list.items.map(({ name }) => name),
        ["Second", "Premier"],
      );
    });

    it("removes a favorite without touching the product, and a repeated removal succeeds", async () => {
      const created = await product();
      await ok(await put(created.id));
      assert.deepEqual(await ok(await remove(created.id)), { items: [] });
      assert.deepEqual(await ok(await remove(created.id)), { items: [] });
      assert.deepEqual(await ok(await remove(randomUUID())), { items: [] });
      const row = await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.status, "PUBLISHED");
    });

    it("gives hidden and unknown products the same 404 on add", async () => {
      const draft = await product({ publish: false });
      const archived = await product({ name: "Archivé" });
      assert.equal((await post(`${sellerBase}/${archived.id}/archive`, seller)).status, 200);
      const { owner, shopId: otherShop } = await h.shopInStatus("APPROVED");
      const suspended = await product({ actor: owner, shop: otherShop, name: "Suspendu" });
      await h.prisma.shop.update({ where: { id: otherShop }, data: { status: "SUSPENDED" } });
      for (const id of [draft.id, archived.id, suspended.id, randomUUID(), "not-a-uuid"]) {
        await expectError(await put(id), 404, "PRODUCT_NOT_FOUND");
      }
      assert.equal(await h.prisma.favorite.count(), 0);
    });

    it("refuses a malformed product ID on removal", async () => {
      await expectError(await remove("not-a-uuid"), 404, "PRODUCT_NOT_FOUND");
    });

    it("allows a sold-out product: favorites are not purchases", async () => {
      const soldOut = await product({ stock: 0 });
      const item = only(await ok(await put(soldOut.id)));
      assert.equal(item.state, "SOLD_OUT");
      assert.equal(item.product?.available, false);
      assert.equal(item.product?.price, "1500.00");
    });

    it(`stops at ${FAVORITES_MAX_ITEMS} products, and still accepts a repeated add at the limit`, async () => {
      const created = await product();
      const filler = await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      // Clones of the same public product, inserted directly to keep the test fast.
      const clones = await Promise.all(
        Array.from({ length: FAVORITES_MAX_ITEMS - 1 }, async (_, index) => {
          const clone = await h.prisma.product.create({
            data: {
              shopId,
              name: `Clone ${index}`,
              description: filler.description,
              category: filler.category,
              price: filler.price,
              stock: 1,
              status: "PUBLISHED",
              publishedAt: new Date(),
            },
          });
          return clone.id;
        }),
      );
      await h.prisma.favorite.createMany({ data: clones.map((productId) => ({ userId: customer.userId, productId })) });
      await ok(await put(created.id));
      assert.equal(await h.prisma.favorite.count({ where: { userId: customer.userId } }), FAVORITES_MAX_ITEMS);
      await ok(await put(created.id));
      const another = await product({ name: "De trop" });
      await expectError(await put(another.id), 409, "FAVORITE_LIMIT_REACHED");
      await ok(await remove(created.id));
      await ok(await put(another.id));
    });

    it("rolls back an add that fails before commit", async () => {
      const created = await product();
      h.faults.favorites.beforeCommit = () => {
        throw new Error("injected");
      };
      assert.equal((await put(created.id)).status, 500);
      delete h.faults.favorites.beforeCommit;
      assert.deepEqual(await read(), { items: [] });
    });
  });

  describe("current product state", () => {
    it("follows the current price and availability, with no snapshot", async () => {
      const created = await product({ price: "1500.00", stock: 2 });
      await ok(await put(created.id));
      await h.prisma.product.update({ where: { id: created.id }, data: { price: "1200.00", stock: 0 } });
      const item = only(await read());
      assert.equal(item.state, "SOLD_OUT");
      assert.equal(item.product?.price, "1200.00");
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 3 } });
      assert.equal(only(await read()).state, "AVAILABLE");
    });

    it("shows archived, unpublished, and suspended-shop products as unavailable, with no price or shop", async () => {
      const archived = await product({ name: "Archivé" });
      const unpublished = await product({ name: "Retiré" });
      const { owner, shopId: otherShop } = await h.shopInStatus("APPROVED");
      const suspended = await product({ actor: owner, shop: otherShop, name: "Suspendu" });
      for (const { id } of [archived, unpublished, suspended]) await ok(await put(id));

      assert.equal((await post(`${sellerBase}/${archived.id}/archive`, seller)).status, 200);
      await h.prisma.product.update({ where: { id: unpublished.id }, data: { status: "DRAFT" } });
      await h.prisma.shop.update({ where: { id: otherShop }, data: { status: "SUSPENDED" } });

      const list = await read();
      assert.equal(list.items.length, 3);
      for (const item of list.items) {
        assert.equal(item.state, "UNAVAILABLE", item.name);
        assert.equal(item.product, null, item.name);
        const text = JSON.stringify(item);
        assert.equal(text.includes("1500"), false, "no price");
        assert.equal(text.includes("Boutique"), false, "no shop");
        assert.equal(text.includes("ARCHIVED") || text.includes("SUSPENDED") || text.includes("DRAFT"), false, "no reason");
      }
      // The products themselves are unchanged by being favorites.
      assert.equal((await h.prisma.product.findUniqueOrThrow({ where: { id: archived.id } })).status, "ARCHIVED");

      // Still removable, and a repeated add of a hidden favorite is idempotent.
      await ok(await put(archived.id));
      assert.equal((await read()).items.length, 3);
      await ok(await remove(archived.id));
      assert.equal((await read()).items.length, 2);
    });

    it("shows a product again once it is public again", async () => {
      const created = await product();
      await ok(await put(created.id));
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal(only(await read()).state, "UNAVAILABLE");
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "APPROVED" } });
      assert.equal(only(await read()).state, "AVAILABLE");
    });

    it("a hidden favorite does not become purchasable: the cart still refuses it", async () => {
      const created = await product();
      await ok(await put(created.id));
      assert.equal((await post(`${sellerBase}/${created.id}/archive`, seller)).status, 200);
      await expectError(await post("/customers/me/cart/items", customer, { productId: created.id, quantity: 1 }), 404, "PRODUCT_NOT_FOUND");
    });

    it("keeps the product reference: a favorited product cannot be hard-deleted", async () => {
      const created = await product();
      await ok(await put(created.id));
      await assert.rejects(h.prisma.product.delete({ where: { id: created.id } }));
    });
  });

  describe("separate from the cart", () => {
    it("adding and removing favorites never changes the cart", async () => {
      const inCart = await product({ name: "Panier" });
      const favorite = await product({ name: "Favori" });
      assert.equal((await post("/customers/me/cart/items", customer, { productId: inCart.id, quantity: 2 })).status, 200);
      const before = (await (await h.call("/customers/me/cart", customer.token)).json()) as Cart;

      await ok(await put(favorite.id));
      await ok(await put(inCart.id));
      await ok(await remove(inCart.id));

      const after = (await (await h.call("/customers/me/cart", customer.token)).json()) as Cart;
      assert.deepEqual(after, before);
      assert.equal(await h.prisma.cartItem.count({ where: { productId: favorite.id } }), 0);
    });

    it("a customer without a cart gets none from favorites", async () => {
      await ok(await put((await product()).id));
      assert.equal(await h.prisma.cart.count(), 0);
    });
  });
});
