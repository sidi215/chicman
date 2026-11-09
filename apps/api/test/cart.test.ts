import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { CART_MAX_ITEMS, cartItemAddSchema, cartItemUpdateSchema, type Cart, type CartItem, type SellerProductDetail } from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { Prisma } from "../src/generated/prisma/client.js";
import { evaluateCartLine, type CartLineState } from "../src/modules/cart/index.js";
import { MEDIA_BASE_URL, ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const money = (value: string) => new Prisma.Decimal(value);

function line(overrides: Partial<Omit<CartLineState, "product">> & { product?: Partial<CartLineState["product"]> } = {}): CartLineState {
  const { product, ...rest } = overrides;
  return {
    quantity: 2,
    priceSnapshot: money("1500.00"),
    variantId: null,
    variantSize: null,
    variantColor: null,
    shopStatus: "APPROVED",
    ...rest,
    product: { status: "PUBLISHED", price: money("1500.00"), stock: 5, hasActiveImage: true, variants: [], ...product },
  };
}

describe("cart contract (spec 09)", () => {
  const productId = randomUUID();

  it("accepts only positive integer quantities", () => {
    for (const quantity of [0, -1, 1.5, "2", null]) {
      assert.equal(cartItemUpdateSchema.safeParse({ quantity }).success, false, `quantity ${String(quantity)}`);
      assert.equal(cartItemAddSchema.safeParse({ productId, quantity }).success, false, `quantity ${String(quantity)}`);
    }
    assert.equal(cartItemUpdateSchema.safeParse({ quantity: 1 }).success, true);
  });

  it("refuses a client price, shop, owner, or stock", () => {
    for (const extra of [{ price: "1.00" }, { unitPrice: "1.00" }, { shopId: randomUUID() }, { userId: randomUUID() }, { stock: 9 }]) {
      assert.equal(cartItemAddSchema.safeParse({ productId, quantity: 1, ...extra }).success, false, Object.keys(extra).join());
      assert.equal(cartItemUpdateSchema.safeParse({ quantity: 1, ...extra }).success, false, Object.keys(extra).join());
    }
  });
});

describe("cart line rules (spec 09, section 7)", () => {
  const codes = (state: CartLineState) => evaluateCartLine(state).issues.map(({ code }) => code);

  it("reports nothing for a line that is fine", () => {
    const result = evaluateCartLine(line());
    assert.deepEqual(result.issues, []);
    assert.equal(result.purchasable, true);
    assert.equal(result.removeOnly, false);
  });

  it("names the reason a product can no longer be bought", () => {
    assert.deepEqual(codes(line({ product: { status: "ARCHIVED" } })), ["PRODUCT_ARCHIVED"]);
    assert.deepEqual(codes(line({ product: { status: "DRAFT" } })), ["PRODUCT_UNPUBLISHED"]);
    assert.deepEqual(codes(line({ product: { hasActiveImage: false } })), ["PRODUCT_UNPUBLISHED"]);
    assert.deepEqual(codes(line({ shopStatus: "SUSPENDED" })), ["SHOP_UNAVAILABLE"]);
    assert.deepEqual(codes(line({ shopStatus: "SUSPENDED", product: { status: "ARCHIVED" } })), ["SHOP_UNAVAILABLE"]);
  });

  it("shows the last seen price, not the current one, once a line is remove-only", () => {
    const result = evaluateCartLine(line({ product: { status: "DRAFT", price: money("9.00") } }));
    assert.equal(result.unitPrice.toFixed(2), "1500.00");
    assert.equal(result.purchasable, false);
    assert.equal(result.removeOnly, true);
  });

  it("flags quantities above the stock, including a sold-out line", () => {
    assert.deepEqual(evaluateCartLine(line({ product: { stock: 1 } })).issues, [{ code: "INSUFFICIENT_STOCK", availableQuantity: 1 }]);
    assert.deepEqual(evaluateCartLine(line({ product: { stock: 0 } })).issues, [{ code: "INSUFFICIENT_STOCK", availableQuantity: 0 }]);
    assert.equal(evaluateCartLine(line({ product: { stock: 0 } })).removeOnly, false);
    assert.equal(evaluateCartLine(line({ product: { stock: 2 } })).purchasable, true);
  });

  it("keeps a price change informative: the line stays purchasable at the new price", () => {
    const result = evaluateCartLine(line({ product: { price: money("1200.00") } }));
    assert.deepEqual(result.issues, [{ code: "PRICE_CHANGED", previousPrice: "1500.00" }]);
    assert.equal(result.purchasable, true);
    assert.equal(result.unitPrice.toFixed(2), "1200.00");
  });

  it("reports a price change together with insufficient stock", () => {
    assert.deepEqual(codes(line({ product: { price: money("1.00"), stock: 1 } })), ["INSUFFICIENT_STOCK", "PRICE_CHANGED"]);
  });

  describe("variants", () => {
    const variant = { id: "v1", size: "M", color: "Noir", stock: 4 };
    const chosen = { variantId: "v1", variantSize: "M", variantColor: "Noir" };

    it("uses the variant's stock, not the product's", () => {
      assert.equal(evaluateCartLine(line({ ...chosen, product: { stock: 0, variants: [variant] } })).purchasable, true);
      assert.deepEqual(codes(line({ ...chosen, product: { stock: 99, variants: [{ ...variant, stock: 1 }] } })), ["INSUFFICIENT_STOCK"]);
    });

    it("ignores a change of case only", () => {
      assert.deepEqual(codes(line({ ...chosen, variantColor: "NOIR", product: { variants: [variant] } })), []);
    });

    it("never treats a removed or renamed variant as the same purchase", () => {
      assert.deepEqual(codes(line({ ...chosen, variantId: null, product: { variants: [variant] } })), ["VARIANT_UNAVAILABLE"]);
      assert.deepEqual(codes(line({ ...chosen, variantId: null })), ["VARIANT_UNAVAILABLE"]);
      assert.deepEqual(codes(line({ ...chosen, product: { variants: [{ ...variant, size: "L" }] } })), ["VARIANT_UNAVAILABLE"]);
    });

    it("flags a line without a variant once the product has variants", () => {
      assert.deepEqual(codes(line({ product: { variants: [variant] } })), ["VARIANT_UNAVAILABLE"]);
    });
  });
});

describe("shopping cart (spec 09, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
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
  const cartPath = "/customers/me/cart";
  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", body });
  const patch = (path: string, actor: Actor, body: unknown) => h.call(path, actor.token, { method: "PATCH", body });
  const remove = (path: string, actor: Actor) => h.call(path, actor.token, { method: "DELETE" });

  interface Spec {
    name?: string;
    price?: string;
    stock?: number;
    variants?: { size?: string; color?: string; stock?: number }[];
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
    for (const variant of spec.variants ?? []) assert.equal((await post(`${sellerBase}/${id}/variants`, actor, variant)).status, 201);
    if (spec.publish !== false) assert.equal((await post(`${sellerBase}/${id}/publish`, actor)).status, 200);
    const detail = await h.call(`${sellerBase}/${id}`, actor.token);
    return (await detail.json()) as SellerProductDetail;
  }

  async function secondShop(): Promise<{ actor: Actor; shop: string }> {
    const { owner, shopId: shop } = await h.shopInStatus("APPROVED");
    await h.prisma.shop.update({ where: { id: shop }, data: { shopName: "Autre Boutique" } });
    return { actor: owner, shop };
  }

  async function ok(response: Response): Promise<Cart> {
    assert.equal(response.status, 200);
    return (await response.json()) as Cart;
  }
  const read = async (actor: Actor = customer) => ok(await h.call(cartPath, actor.token));
  const add = (productId: string, quantity: number, variantId?: string, actor: Actor = customer) =>
    post(`${cartPath}/items`, actor, { productId, quantity, ...(variantId === undefined ? {} : { variantId }) });
  const firstItem = (cart: Cart): CartItem => {
    const item = cart.shops[0]?.items[0];
    assert.ok(item);
    return item;
  };
  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  async function addOne(spec: Spec = {}, quantity = 1): Promise<{ product: SellerProductDetail; item: CartItem }> {
    const created = await product(spec);
    const cart = await ok(await add(created.id, quantity));
    return { product: created, item: firstItem(cart) };
  }

  describe("authorization and ownership", () => {
    it("requires a signed-in, bootstrapped user on every route", async () => {
      const id = randomUUID();
      for (const [method, path] of [
        ["GET", cartPath],
        ["DELETE", cartPath],
        ["POST", `${cartPath}/items`],
        ["PATCH", `${cartPath}/items/${id}`],
        ["DELETE", `${cartPath}/items/${id}`],
        ["POST", `${cartPath}/items/${id}/accept-price`],
      ] as const) {
        assert.equal((await h.call(path, null, { method })).status, 401, `${method} ${path}`);
      }
    });

    it("ties the cart to the authenticated user: another customer's line is 404", async () => {
      const { item } = await addOne();
      const other = await h.actor();
      assert.deepEqual(await read(other), { shops: [], itemCount: 0, subtotal: "0.00" });
      await expectError(await patch(`${cartPath}/items/${item.id}`, other, { quantity: 1 }), 404, "CART_ITEM_NOT_FOUND");
      await expectError(await remove(`${cartPath}/items/${item.id}`, other), 404, "CART_ITEM_NOT_FOUND");
      await expectError(await post(`${cartPath}/items/${item.id}/accept-price`, other, { price: "1500.00" }), 404, "CART_ITEM_NOT_FOUND");
      // Even when that customer has a cart of their own.
      const second = await product({ name: "Autre" });
      await ok(await add(second.id, 1, undefined, other));
      await expectError(await remove(`${cartPath}/items/${item.id}`, other), 404, "CART_ITEM_NOT_FOUND");
      assert.equal((await read()).itemCount, 1);
    });

    it("persists across sessions, under the application user", async () => {
      const { item } = await addOne({}, 2);
      const row = await h.prisma.cart.findUniqueOrThrow({ where: { userId: customer.userId }, include: { items: true } });
      assert.equal(row.items[0]?.id, item.id);
      // Signing in again gives a new token for the same identity.
      const nextSession = await h.newSession(customer);
      assert.notEqual(nextSession.token, customer.token);
      assert.equal(firstItem(await read(nextSession)).id, item.id);
    });

    it("rate-limits writes per user, not reads", async () => {
      const created = await product();
      h.cartRateLimiter = { hit: () => Promise.resolve({ allowed: false, retryAfterSeconds: 60 }) };
      assert.equal((await add(created.id, 1)).status, 429);
      assert.equal((await h.call(cartPath, customer.token)).status, 200);
    });
  });

  describe("adding items", () => {
    it("starts empty without writing anything on read", async () => {
      assert.deepEqual(await read(), { shops: [], itemCount: 0, subtotal: "0.00" });
      assert.equal(await h.prisma.cart.count(), 0);
    });

    it("adds a product with server prices, its shop, and image", async () => {
      const created = await product({ price: "1500.50" });
      const cart = await ok(await add(created.id, 2));
      assert.equal(cart.itemCount, 2);
      assert.equal(cart.subtotal, "3001.00");
      assert.deepEqual(cart.shops[0]?.shop, { id: shopId, name: "Boutique Test" });
      assert.equal(cart.shops[0]?.subtotal, "3001.00");
      const item = firstItem(cart);
      assert.equal(item.productId, created.id);
      assert.equal(item.name, "Melhfa");
      assert.equal(item.unitPrice, "1500.50");
      assert.equal(item.subtotal, "3001.00");
      assert.deepEqual(item.issues, []);
      assert.ok(item.imageUrl?.startsWith(`${MEDIA_BASE_URL}/`));
      const row = await h.prisma.cartItem.findUniqueOrThrow({ where: { id: item.id } });
      assert.equal(row.shopId, shopId);
      assert.equal(row.priceSnapshot.toFixed(2), "1500.50");
    });

    it("never exposes the stock figure of a line that is fine", async () => {
      const { item } = await addOne({ stock: 5 });
      assert.equal(JSON.stringify(item).includes('"stock"'), false);
      assert.equal(JSON.stringify(item).includes("availableQuantity"), false);
    });

    it("refuses a client price, shop, or malformed quantity", async () => {
      const created = await product();
      for (const body of [
        { productId: created.id, quantity: 1, price: "1.00" },
        { productId: created.id, quantity: 1, shopId: randomUUID() },
        { productId: created.id, quantity: 0 },
        { productId: created.id, quantity: -1 },
        { productId: created.id, quantity: 1.5 },
        { productId: created.id, quantity: "1" },
        { productId: created.id },
        { productId: "not-a-uuid", quantity: 1 },
      ]) {
        assert.equal((await post(`${cartPath}/items`, customer, body)).status, 400, JSON.stringify(body));
      }
      assert.equal(await h.prisma.cartItem.count(), 0);
    });

    it("merges into the existing line and checks the combined quantity", async () => {
      const created = await product({ stock: 5 });
      await ok(await add(created.id, 2));
      const cart = await ok(await add(created.id, 3));
      assert.equal(cart.shops[0]?.items.length, 1);
      assert.equal(firstItem(cart).quantity, 5);
      await expectError(await add(created.id, 1), 409, "CART_INSUFFICIENT_STOCK");
      assert.equal(firstItem(await read()).quantity, 5);
    });

    it("refuses more than the stock, and a sold-out product", async () => {
      const created = await product({ stock: 2 });
      await expectError(await add(created.id, 3), 409, "CART_INSUFFICIENT_STOCK");
      const soldOut = await product({ stock: 0, name: "Épuisé" });
      await expectError(await add(soldOut.id, 1), 409, "CART_INSUFFICIENT_STOCK");
      assert.equal(await h.prisma.cart.count(), 0, "a refused first add leaves no cart");
    });

    it("gives hidden products the same 404 as unknown ones", async () => {
      const draft = await product({ publish: false });
      const archived = await product({ name: "Archivé" });
      assert.equal((await post(`${sellerBase}/${archived.id}/archive`, seller)).status, 200);
      const { actor, shop } = await secondShop();
      const suspended = await product({ actor, shop, name: "Suspendu" });
      await h.prisma.shop.update({ where: { id: shop }, data: { status: "SUSPENDED" } });
      for (const id of [draft.id, archived.id, suspended.id, randomUUID()]) {
        await expectError(await add(id, 1), 404, "PRODUCT_NOT_FOUND");
      }
    });

    it("holds a limit on the number of lines", async () => {
      const created = await product();
      const { id: cartId } = await h.prisma.cart.create({ data: { userId: customer.userId } });
      const filler = await h.prisma.product.create({ data: { shopId, name: "Filler", description: "x", category: "CLOTHING", price: "1.00" } });
      for (let index = 0; index < CART_MAX_ITEMS; index += 1) {
        const variant = await h.prisma.productVariant.create({ data: { productId: filler.id, size: `S${index}`, stock: 1 } });
        await h.prisma.cartItem.create({
          data: { cartId, productId: filler.id, shopId, variantId: variant.id, variantSize: variant.size, quantity: 1, priceSnapshot: "1.00" },
        });
      }
      await expectError(await add(created.id, 1), 409, "CART_LIMIT_REACHED");
    });

    it("keeps concurrent adds on one line within the stock", async () => {
      const created = await product({ stock: 3 });
      const results = await Promise.all(Array.from({ length: 6 }, () => add(created.id, 1)));
      assert.equal(results.filter(({ status }) => status === 200).length, 3);
      assert.equal(results.filter(({ status }) => status === 409).length, 3);
      const cart = await read();
      assert.equal(cart.shops[0]?.items.length, 1);
      assert.equal(firstItem(cart).quantity, 3);
    });

    it("rolls back with the transaction", async () => {
      const created = await product();
      h.faults.cart.beforeCommit = () => {
        throw new Error("boom");
      };
      assert.equal((await add(created.id, 1)).status, 500);
      delete h.faults.cart.beforeCommit;
      assert.equal(await h.prisma.cart.count(), 0);
      assert.equal(await h.prisma.cartItem.count(), 0);
    });
  });

  describe("variants", () => {
    const withVariants = () =>
      product({
        variants: [
          { size: "M", color: "Noir", stock: 2 },
          { size: "L", color: "Noir", stock: 0 },
        ],
      });
    const variantId = (created: SellerProductDetail, size: string): string => {
      const found = created.variants.find((variant) => variant.size === size);
      assert.ok(found);
      return found.id;
    };

    it("requires a variant when the product has them", async () => {
      await expectError(await add((await withVariants()).id, 1), 409, "CART_VARIANT_REQUIRED");
    });

    it("verifies the variant belongs to the product", async () => {
      const created = await withVariants();
      const other = await product({ name: "Autre", variants: [{ size: "S", stock: 5 }] });
      await expectError(await add(created.id, 1, variantId(other, "S")), 404, "CART_VARIANT_NOT_FOUND");
      await expectError(await add(created.id, 1, randomUUID()), 404, "CART_VARIANT_NOT_FOUND");
      const plain = await product({ name: "Simple" });
      await expectError(await add(plain.id, 1, variantId(other, "S")), 404, "CART_VARIANT_NOT_FOUND");
      assert.equal(await h.prisma.cartItem.count(), 0);
    });

    it("checks the variant's own stock and keeps the chosen values", async () => {
      const created = await withVariants();
      await expectError(await add(created.id, 1, variantId(created, "L")), 409, "CART_INSUFFICIENT_STOCK");
      await expectError(await add(created.id, 3, variantId(created, "M")), 409, "CART_INSUFFICIENT_STOCK");
      const item = firstItem(await ok(await add(created.id, 2, variantId(created, "M"))));
      assert.equal(item.size, "M");
      assert.equal(item.color, "Noir");
      assert.equal(item.variantId, variantId(created, "M"));
    });

    it("gives each variant its own line", async () => {
      const created = await product({
        variants: [
          { size: "M", stock: 5 },
          { size: "L", stock: 5 },
        ],
      });
      await ok(await add(created.id, 1, variantId(created, "M")));
      const cart = await ok(await add(created.id, 1, variantId(created, "L")));
      assert.deepEqual(cart.shops[0]?.items.map((item) => item.size), ["M", "L"]);
    });

    it("flags a removed variant and keeps what was chosen; the database row survives", async () => {
      const created = await withVariants();
      const id = variantId(created, "M");
      await ok(await add(created.id, 1, id));
      assert.equal((await remove(`${sellerBase}/${created.id}/variants/${id}`, seller)).status, 200);
      const item = firstItem(await read());
      assert.deepEqual(item.issues, [{ code: "VARIANT_UNAVAILABLE" }]);
      assert.equal(item.variantId, null);
      assert.equal(item.size, "M");
      assert.equal(item.color, "Noir");
      assert.equal(item.quantity, 1);
      await expectError(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 1 }), 409, "CART_ITEM_UNAVAILABLE");
      assert.equal((await ok(await remove(`${cartPath}/items/${item.id}`, customer))).itemCount, 0);
    });

    it("flags a renamed variant rather than changing the purchase, until it is chosen again", async () => {
      const created = await withVariants();
      const id = variantId(created, "M");
      await ok(await add(created.id, 1, id));
      assert.equal((await patch(`${sellerBase}/${created.id}/variants/${id}`, seller, { size: "XL" })).status, 200);
      const flagged = firstItem(await read());
      assert.deepEqual(flagged.issues, [{ code: "VARIANT_UNAVAILABLE" }]);
      assert.equal(flagged.size, "M");
      const chosen = firstItem(await ok(await add(created.id, 1, id)));
      assert.deepEqual(chosen.issues, []);
      assert.equal(chosen.size, "XL");
      assert.equal(chosen.quantity, 2);
    });

    it("flags a line without a variant once the product gains variants", async () => {
      const { product: created, item } = await addOne();
      assert.equal((await post(`${sellerBase}/${created.id}/variants`, seller, { size: "M", stock: 3 })).status, 201);
      assert.deepEqual(firstItem(await read()).issues, [{ code: "VARIANT_UNAVAILABLE" }]);
      await expectError(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 1 }), 409, "CART_ITEM_UNAVAILABLE");
    });

    it("allows two lines whose variants were removed, without a uniqueness failure", async () => {
      const created = await product({
        variants: [
          { size: "M", stock: 5 },
          { size: "L", stock: 5 },
        ],
      });
      await ok(await add(created.id, 1, variantId(created, "M")));
      await ok(await add(created.id, 1, variantId(created, "L")));
      assert.equal((await remove(`${sellerBase}/${created.id}/variants/${variantId(created, "M")}`, seller)).status, 200);
      assert.equal((await remove(`${sellerBase}/${created.id}/variants/${variantId(created, "L")}`, seller)).status, 200);
      const cart = await read();
      assert.deepEqual(cart.shops[0]?.items.map((item) => item.size), ["M", "L"]);
      assert.equal(cart.subtotal, "0.00");
    });
  });

  describe("multiple shops", () => {
    it("keeps one cart, grouped by shop, with shop and overall subtotals", async () => {
      const first = await product({ price: "100.00" });
      const { actor, shop } = await secondShop();
      const second = await product({ actor, shop, price: "250.50" });
      const third = await product({ name: "Autre", price: "10.00" });
      await ok(await add(first.id, 2));
      await ok(await add(second.id, 1));
      const cart = await ok(await add(third.id, 3));
      assert.equal(await h.prisma.cart.count(), 1);
      assert.deepEqual(cart.shops.map((group) => [group.shop.id, group.items.length, group.subtotal]), [
        [shopId, 2, "230.00"],
        [shop, 1, "250.50"],
      ]);
      assert.equal(cart.itemCount, 6);
      assert.equal(cart.subtotal, "480.50");
    });

    it("computes exact decimals with no floating point error", async () => {
      const created = await product({ price: "0.10" });
      const cart = await ok(await add(created.id, 3));
      assert.equal(firstItem(cart).subtotal, "0.30");
      assert.equal(cart.subtotal, "0.30");
    });
  });

  describe("updating and removing", () => {
    it("updates a quantity within the stock and recalculates", async () => {
      const { item } = await addOne({ stock: 5, price: "100.00" });
      const cart = await ok(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 4 }));
      assert.equal(firstItem(cart).quantity, 4);
      assert.equal(cart.subtotal, "400.00");
    });

    it("refuses invalid quantities and more than the stock, leaving the line unchanged", async () => {
      const { item } = await addOne({ stock: 2 });
      for (const quantity of [0, -1, 1.5, "2"]) {
        assert.equal((await patch(`${cartPath}/items/${item.id}`, customer, { quantity })).status, 400);
      }
      await expectError(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 3 }), 409, "CART_INSUFFICIENT_STOCK");
      assert.equal(firstItem(await read()).quantity, 1);
    });

    it("treats a malformed line ID as not found", async () => {
      await expectError(await patch(`${cartPath}/items/nope`, customer, { quantity: 1 }), 404, "CART_ITEM_NOT_FOUND");
      await expectError(await remove(`${cartPath}/items/nope`, customer), 404, "CART_ITEM_NOT_FOUND");
    });

    it("removes one line, then 404 on a second attempt", async () => {
      const { item } = await addOne();
      const cart = await ok(await remove(`${cartPath}/items/${item.id}`, customer));
      assert.deepEqual(cart, { shops: [], itemCount: 0, subtotal: "0.00" });
      await expectError(await remove(`${cartPath}/items/${item.id}`, customer), 404, "CART_ITEM_NOT_FOUND");
    });

    it("clears the whole cart, and clearing again still succeeds", async () => {
      await addOne();
      assert.deepEqual(await ok(await remove(cartPath, customer)), { shops: [], itemCount: 0, subtotal: "0.00" });
      assert.deepEqual(await ok(await remove(cartPath, customer)), { shops: [], itemCount: 0, subtotal: "0.00" });
      const noCart = await h.actor();
      assert.deepEqual(await ok(await remove(cartPath, noCart)), { shops: [], itemCount: 0, subtotal: "0.00" });
    });

    it("takes nothing from product stock: the cart reserves nothing", async () => {
      const { product: created } = await addOne({ stock: 5 }, 5);
      const row = await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(row.stock, 5);
      const other = await h.actor();
      assert.equal((await add(created.id, 5, undefined, other)).status, 200);
    });
  });

  describe("items that change after being added", () => {
    it("identifies an archived product, excludes it from totals, and allows removal", async () => {
      const { product: created, item } = await addOne({ price: "100.00" });
      assert.equal((await post(`${sellerBase}/${created.id}/archive`, seller)).status, 200);
      const cart = await read();
      assert.deepEqual(firstItem(cart).issues, [{ code: "PRODUCT_ARCHIVED" }]);
      assert.equal(firstItem(cart).purchasable, false);
      assert.equal(cart.subtotal, "0.00");
      assert.equal(cart.shops[0]?.subtotal, "0.00");
      assert.equal(cart.itemCount, 1);
      await expectError(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 1 }), 409, "CART_ITEM_UNAVAILABLE");
      await expectError(await post(`${cartPath}/items/${item.id}/accept-price`, customer, { price: "100.00" }), 409, "CART_ITEM_UNAVAILABLE");
      assert.equal((await ok(await remove(`${cartPath}/items/${item.id}`, customer))).itemCount, 0);
    });

    it("identifies an unpublished product and hides its current draft price", async () => {
      const { product: created } = await addOne({ price: "100.00" });
      assert.equal((await post(`${sellerBase}/${created.id}/archive`, seller)).status, 200);
      assert.equal((await post(`${sellerBase}/${created.id}/restore`, seller)).status, 200);
      assert.equal((await patch(`${sellerBase}/${created.id}`, seller, { price: "999.00" })).status, 200);
      const item = firstItem(await read());
      assert.deepEqual(item.issues, [{ code: "PRODUCT_UNPUBLISHED" }]);
      assert.equal(item.unitPrice, "100.00");
    });

    it("identifies a suspended shop's products and recovers on reinstatement", async () => {
      const { item } = await addOne({ price: "100.00" });
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      const suspended = await read();
      assert.deepEqual(firstItem(suspended).issues, [{ code: "SHOP_UNAVAILABLE" }]);
      assert.equal(suspended.subtotal, "0.00");
      await expectError(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 1 }), 409, "CART_ITEM_UNAVAILABLE");
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "APPROVED" } });
      const back = await read();
      assert.deepEqual(firstItem(back).issues, []);
      assert.equal(back.subtotal, "100.00");
    });

    it("reports insufficient stock without changing the quantity, then lets it be corrected", async () => {
      const { product: created, item } = await addOne({ stock: 5, price: "100.00" }, 4);
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 2 } });
      const short = await read();
      assert.deepEqual(firstItem(short).issues, [{ code: "INSUFFICIENT_STOCK", availableQuantity: 2 }]);
      assert.equal(firstItem(short).quantity, 4, "the quantity is never changed silently");
      assert.equal(firstItem(short).purchasable, false);
      assert.equal(short.subtotal, "0.00");
      const fixed = await ok(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 2 }));
      assert.deepEqual(firstItem(fixed).issues, []);
      assert.equal(fixed.subtotal, "200.00");
    });

    it("recovers when a sold-out line is replenished, with no change from the customer", async () => {
      const { product: created } = await addOne({ stock: 2 }, 1);
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 0 } });
      assert.deepEqual(firstItem(await read()).issues, [{ code: "INSUFFICIENT_STOCK", availableQuantity: 0 }]);
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 2 } });
      assert.deepEqual(firstItem(await read()).issues, []);
    });

    describe("price changes", () => {
      async function changedPrice() {
        const added = await addOne({ price: "100.00" }, 2);
        assert.equal((await patch(`${sellerBase}/${added.product.id}`, seller, { price: "150.00" })).status, 200);
        return added;
      }

      it("recalculates from the current price and reports the previous one", async () => {
        await changedPrice();
        const cart = await read();
        const item = firstItem(cart);
        assert.deepEqual(item.issues, [{ code: "PRICE_CHANGED", previousPrice: "100.00" }]);
        assert.equal(item.unitPrice, "150.00");
        assert.equal(item.subtotal, "300.00");
        assert.equal(cart.subtotal, "300.00");
        assert.equal(item.purchasable, true);
      });

      it("reading does not clear the warning", async () => {
        await changedPrice();
        await read();
        assert.equal(firstItem(await read()).issues.length, 1);
      });

      it("changing the quantity or adding more does not acknowledge it", async () => {
        const { product: created, item } = await changedPrice();
        const updated = firstItem(await ok(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 3 })));
        assert.deepEqual(updated.issues, [{ code: "PRICE_CHANGED", previousPrice: "100.00" }]);
        const added = firstItem(await ok(await add(created.id, 1)));
        assert.deepEqual(added.issues, [{ code: "PRICE_CHANGED", previousPrice: "100.00" }]);
      });

      it("clears once the customer accepts the price they saw", async () => {
        const { item } = await changedPrice();
        const accepted = firstItem(await ok(await post(`${cartPath}/items/${item.id}/accept-price`, customer, { price: "150.00" })));
        assert.deepEqual(accepted.issues, []);
        assert.equal(accepted.unitPrice, "150.00");
      });

      it("refuses to accept a price that is not the current one: nothing the client sends is stored", async () => {
        const { item } = await changedPrice();
        await expectError(await post(`${cartPath}/items/${item.id}/accept-price`, customer, { price: "1.00" }), 409, "CART_PRICE_CHANGED");
        const unchanged = firstItem(await read());
        assert.equal(unchanged.unitPrice, "150.00");
        assert.deepEqual(unchanged.issues, [{ code: "PRICE_CHANGED", previousPrice: "100.00" }]);
        const row = await h.prisma.cartItem.findUniqueOrThrow({ where: { id: item.id } });
        assert.equal(row.priceSnapshot.toFixed(2), "100.00");
      });

      it("clears on its own when the price returns to the accepted one", async () => {
        const { product: created } = await changedPrice();
        assert.equal((await patch(`${sellerBase}/${created.id}`, seller, { price: "100.00" })).status, 200);
        assert.deepEqual(firstItem(await read()).issues, []);
      });
    });
  });

  describe("conditional stock visibility (approved decision)", () => {
    const hasStockFigure = (value: unknown): boolean => /"(stock|availableQuantity|stockQuantity)"/.test(JSON.stringify(value));

    it("shows the figure only on the line above the stock, never on the others in the cart", async () => {
      const short = await product({ name: "Court", stock: 5 });
      const fine = await product({ name: "Normal", stock: 9 });
      const { actor, shop } = await secondShop();
      const otherSeller = await product({ actor, shop, name: "Autre vendeur", stock: 7 });
      await ok(await add(short.id, 4));
      await ok(await add(fine.id, 1));
      await ok(await add(otherSeller.id, 1));
      await h.prisma.product.update({ where: { id: short.id }, data: { stock: 2 } });

      const cart = await read();
      const items = cart.shops.flatMap((group) => group.items);
      const shortLine = items.find((item) => item.productId === short.id);
      assert.deepEqual(shortLine?.issues, [{ code: "INSUFFICIENT_STOCK", availableQuantity: 2 }]);
      for (const item of items.filter((candidate) => candidate.productId !== short.id)) {
        assert.equal(hasStockFigure(item), false, item.name);
      }
      assert.equal(JSON.stringify(cart).includes(":9"), false, "the other line's stock appears nowhere");
      assert.equal(JSON.stringify(cart).includes(":7"), false, "the other seller's stock appears nowhere");
    });

    it("reports that variant's stock, never a sibling's or the product total", async () => {
      const created = await product({
        stock: 50,
        variants: [
          { size: "M", stock: 4 },
          { size: "L", stock: 30 },
        ],
      });
      const medium = created.variants.find((variant) => variant.size === "M");
      assert.ok(medium);
      await ok(await add(created.id, 4, medium.id));
      await h.prisma.productVariant.update({ where: { id: medium.id }, data: { stock: 1 } });
      const cart = await read();
      assert.deepEqual(firstItem(cart).issues, [{ code: "INSUFFICIENT_STOCK", availableQuantity: 1 }]);
      for (const figure of ["30", "31", "50"]) assert.equal(JSON.stringify(firstItem(cart).issues).includes(figure), false, figure);
    });

    it("shows no figure at exactly the stock, or on a line that can only be removed", async () => {
      const { product: created } = await addOne({ stock: 5 }, 5);
      assert.equal(hasStockFigure(await read()), false);
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 1 } });
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal(hasStockFigure(await read()), false, "a suspended shop's stock stays private");
    });

    it("never gives a figure in a refusal: errors carry only the code", async () => {
      const created = await product({ stock: 2 });
      await expectError(await add(created.id, 3), 409, "CART_INSUFFICIENT_STOCK");
      const { item } = await addOne({ name: "Autre", stock: 2 });
      await expectError(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 3 }), 409, "CART_INSUFFICIENT_STOCK");
    });

    it("keeps stock figures out of the public listing and product details, even with a short cart line", async () => {
      const { product: created } = await addOne({ stock: 5, variants: [] }, 4);
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 2 } });
      const withVariants = await product({ name: "Variantes", variants: [{ size: "M", stock: 3 }] });
      for (const path of ["/products", `/products/${created.id}`, `/products/${withVariants.id}`]) {
        const response = await h.call(path, null);
        assert.equal(response.status, 200);
        assert.equal(hasStockFigure(await response.json()), false, path);
      }
      const signedIn = await h.call(`/products/${created.id}`, customer.token);
      assert.equal(hasStockFigure(await signedIn.json()), false, "signed in changes nothing");
    });

    it("leaves the requested quantity alone across reads until the customer corrects it", async () => {
      const { product: created, item } = await addOne({ stock: 5 }, 4);
      await h.prisma.product.update({ where: { id: created.id }, data: { stock: 2 } });
      await read();
      await read();
      assert.equal((await h.prisma.cartItem.findUniqueOrThrow({ where: { id: item.id } })).quantity, 4);
      assert.equal(firstItem(await ok(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 2 }))).quantity, 2);
    });

    it("recalculates from the server: a client stock value is refused and changes nothing", async () => {
      const { product: created, item } = await addOne({ stock: 2 });
      for (const body of [
        { quantity: 99, stock: 99 },
        { quantity: 99, availableQuantity: 99 },
      ]) {
        assert.equal((await patch(`${cartPath}/items/${item.id}`, customer, body)).status, 400);
      }
      assert.equal((await post(`${cartPath}/items`, customer, { productId: created.id, quantity: 1, availableQuantity: 99 })).status, 400);
      assert.equal(firstItem(await read()).quantity, 1);
      assert.equal((await h.prisma.product.findUniqueOrThrow({ where: { id: created.id } })).stock, 2);
    });
  });

  describe("accepting a changed price (approved decision)", () => {
    const acceptPath = (id: string) => `${cartPath}/items/${id}/accept-price`;
    const snapshot = async (id: string) => (await h.prisma.cartItem.findUniqueOrThrow({ where: { id } })).priceSnapshot.toFixed(2);
    const setPrice = async (id: string, price: string) => assert.equal((await patch(`${sellerBase}/${id}`, seller, { price })).status, 200);

    async function changed() {
      const added = await addOne({ price: "100.00" }, 2);
      await setPrice(added.product.id, "150.00");
      return added;
    }

    it("refuses a stale acceptance: the price the customer saw is no longer current", async () => {
      const { product: created, item } = await changed();
      const seen = firstItem(await read()).unitPrice;
      await setPrice(created.id, "200.00");
      await expectError(await post(acceptPath(item.id), customer, { price: seen }), 409, "CART_PRICE_CHANGED");
      assert.equal(await snapshot(item.id), "100.00");
      const current = firstItem(await read());
      assert.equal(current.unitPrice, "200.00");
      assert.deepEqual(current.issues, [{ code: "PRICE_CHANGED", previousPrice: "100.00" }]);
    });

    it("an earlier acceptance does not carry over: a further change must be accepted again", async () => {
      const { product: created, item } = await changed();
      assert.deepEqual(firstItem(await ok(await post(acceptPath(item.id), customer, { price: "150.00" }))).issues, []);
      await setPrice(created.id, "175.00");
      assert.deepEqual(firstItem(await read()).issues, [{ code: "PRICE_CHANGED", previousPrice: "150.00" }]);
      await expectError(await post(acceptPath(item.id), customer, { price: "150.00" }), 409, "CART_PRICE_CHANGED");
      assert.deepEqual(firstItem(await ok(await post(acceptPath(item.id), customer, { price: "175.00" }))).issues, []);
      assert.equal(await snapshot(item.id), "175.00");
    });

    it("an accepted price that returns after a change warns again", async () => {
      const { product: created, item } = await changed();
      await ok(await post(acceptPath(item.id), customer, { price: "150.00" }));
      await setPrice(created.id, "100.00");
      assert.deepEqual(firstItem(await read()).issues, [{ code: "PRICE_CHANGED", previousPrice: "150.00" }]);
    });

    it("repeating an acceptance changes nothing", async () => {
      const { item } = await changed();
      const first = await ok(await post(acceptPath(item.id), customer, { price: "150.00" }));
      const second = await ok(await post(acceptPath(item.id), customer, { price: "150.00" }));
      assert.deepEqual(second, first);
      assert.equal(await snapshot(item.id), "150.00");
    });

    it("stays consistent when the price changes while it is being accepted", async () => {
      for (let round = 0; round < 5; round += 1) {
        const name = `Course ${round}`;
        const created = await product({ name, price: "100.00" });
        const cart = await ok(await add(created.id, 1));
        const item = cart.shops.flatMap((group) => group.items).find((line) => line.productId === created.id);
        assert.ok(item);
        await setPrice(created.id, "150.00");
        const [accept, change] = await Promise.all([post(acceptPath(item.id), customer, { price: "150.00" }), patch(`${sellerBase}/${created.id}`, seller, { price: "200.00" })]);
        assert.equal(change.status, 200);
        assert.ok(accept.status === 200 || accept.status === 409, String(accept.status));
        // Whichever came first, 200.00 was never accepted, so a warning remains.
        assert.equal(await snapshot(item.id), accept.status === 200 ? "150.00" : "100.00");
        const after = (await read()).shops.flatMap((group) => group.items).find((line) => line.id === item.id);
        assert.equal(after?.unitPrice, "200.00");
        assert.equal(after?.issues.some(({ code }) => code === "PRICE_CHANGED"), true);
      }
    });

    it("refuses tampered requests, and only a price from the server is ever stored", async () => {
      const { item } = await changed();
      for (const body of [
        {},
        { price: 150 },
        { price: "-150.00" },
        { price: "0.00" },
        { price: "abc" },
        { price: "150.001" },
        { price: "150.00", priceSnapshot: "1.00" },
        { price: "150.00", unitPrice: "1.00" },
        { price: "150.00", quantity: 1 },
        { price: "150.00", shopId: randomUUID() },
      ]) {
        assert.equal((await post(acceptPath(item.id), customer, body)).status, 400, JSON.stringify(body));
      }
      for (const price of ["1.00", "100.00", "149.99", "9999999.00"]) {
        await expectError(await post(acceptPath(item.id), customer, { price }), 409, "CART_PRICE_CHANGED");
      }
      assert.equal(await snapshot(item.id), "100.00");
      assert.equal(firstItem(await ok(await post(acceptPath(item.id), customer, { price: "150" }))).unitPrice, "150.00");
      assert.equal(await snapshot(item.id), "150.00");
    });

    it("recalculates totals on every read and every write from the current price", async () => {
      const { product: created, item } = await addOne({ price: "100.00", stock: 9 }, 2);
      await setPrice(created.id, "150.00");
      assert.equal((await read()).subtotal, "300.00");
      assert.equal((await ok(await patch(`${cartPath}/items/${item.id}`, customer, { quantity: 3 }))).subtotal, "450.00");
      await setPrice(created.id, "160.00");
      assert.equal((await ok(await add(created.id, 1))).subtotal, "640.00");
      await setPrice(created.id, "170.00");
      assert.equal((await ok(await post(acceptPath(item.id), customer, { price: "170.00" }))).subtotal, "680.00");
      const other = await product({ name: "Autre", price: "10.00" });
      await setPrice(created.id, "180.00");
      assert.equal((await ok(await add(other.id, 1))).subtotal, "730.00");
    });
  });

  describe("database guards", () => {
    it("refuses a second line for one variant-less product, a zero quantity, and a bad price", async () => {
      const { product: created } = await addOne();
      const { id: cartId } = await h.prisma.cart.findUniqueOrThrow({ where: { userId: customer.userId } });
      const base = { cartId, productId: created.id, shopId };
      await assert.rejects(h.prisma.cartItem.create({ data: { ...base, quantity: 1, priceSnapshot: "1.00" } }));
      const other = await product({ name: "Autre" });
      const row = { ...base, productId: other.id };
      await assert.rejects(h.prisma.cartItem.create({ data: { ...row, quantity: 0, priceSnapshot: "1.00" } }));
      await assert.rejects(h.prisma.cartItem.create({ data: { ...row, quantity: 1, priceSnapshot: "0.00" } }));
    });

    it("refuses a selected variant with no recorded values", async () => {
      const created = await product({ variants: [{ size: "M", stock: 2 }] });
      const { id: cartId } = await h.prisma.cart.create({ data: { userId: customer.userId } });
      const variant = created.variants[0];
      assert.ok(variant);
      await assert.rejects(h.prisma.cartItem.create({ data: { cartId, productId: created.id, shopId, variantId: variant.id, quantity: 1, priceSnapshot: "1.00" } }));
    });
  });
});
