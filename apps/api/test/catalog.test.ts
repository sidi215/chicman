import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  catalogListQuerySchema,
  isPriceRangeValid,
  type CatalogFacetsResponse,
  type ProductCategory,
  type PublicProductDetail,
  type PublicProductListResponse,
  type SellerProductDetail,
} from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { catalogWhere, PUBLIC_PRODUCT_WHERE } from "../src/modules/products/index.js";
import { CATALOG_INTERNAL_KEY, MEDIA_BASE_URL, ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

describe("catalog query contract (spec 08)", () => {
  it("applies defaults and normalizes price bounds", () => {
    const query = catalogListQuerySchema.parse({ minPrice: "0", maxPrice: "1500.5" });
    assert.deepEqual(query, { minPrice: "0.00", maxPrice: "1500.50", sort: "newest", page: 1, pageSize: 20 });
  });

  it("compares bounds as decimals, not as text or floats", () => {
    assert.equal(isPriceRangeValid("900.00", "1000.00"), true);
    assert.equal(isPriceRangeValid("1000.00", "900.00"), false);
    assert.equal(isPriceRangeValid("5.00", "5.00"), true);
    assert.equal(isPriceRangeValid("9999999999.98", "9999999999.99"), true);
    assert.equal(isPriceRangeValid(undefined, "5.00"), true);
  });

  it("always starts from PUBLIC_PRODUCT_WHERE, whatever the filters", () => {
    for (const filters of [{}, { category: "SHOES" as const }, { availability: "available" as const, size: "M", color: "Noir" }]) {
      const where = catalogWhere(filters);
      assert.ok(Array.isArray(where.AND));
      assert.equal(where.AND[0], PUBLIC_PRODUCT_WHERE);
      assert.equal(Object.keys(where).length, 1);
    }
  });
});

describe("public catalog (spec 08, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
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
  });

  const base = "/sellers/me/products";
  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", body });

  interface Spec {
    name?: string;
    category?: ProductCategory;
    price?: string;
    stock?: number;
    variants?: { size?: string; color?: string; stock?: number }[];
    actor?: Actor;
    shop?: string;
    publish?: boolean;
    images?: number;
  }

  async function addImage(productId: string, actor: Actor, shop: string): Promise<void> {
    const res = await post(`${base}/${productId}/images/uploads`, actor, { contentType: "image/png", contentLength: tiny.byteLength });
    assert.equal(res.status, 201);
    const { uploadId } = (await res.json()) as { uploadId: string };
    h.storage.staging.set(`product-images/${shop}/${productId}/${uploadId}`, tiny);
    assert.equal((await post(`${base}/${productId}/images/uploads/${uploadId}/complete`, actor)).status, 200);
  }

  /** Goes through the real seller routes, so the rows are what sellers really produce. */
  async function product(spec: Spec = {}): Promise<SellerProductDetail> {
    const actor = spec.actor ?? seller;
    const shop = spec.shop ?? shopId;
    const res = await post(base, actor, {
      name: spec.name ?? "Melhfa",
      description: "Voile léger.\nPlusieurs coloris.",
      category: spec.category ?? "CLOTHING",
      price: spec.price ?? "1500.00",
      stock: spec.stock ?? 3,
    });
    assert.equal(res.status, 201);
    const created = (await res.json()) as SellerProductDetail;
    for (let index = 0; index < (spec.images ?? 1); index += 1) await addImage(created.id, actor, shop);
    for (const variant of spec.variants ?? []) {
      assert.equal((await post(`${base}/${created.id}/variants`, actor, variant)).status, 201);
    }
    if (spec.publish !== false) assert.equal((await post(`${base}/${created.id}/publish`, actor)).status, 200);
    return created;
  }

  async function list(query = ""): Promise<PublicProductListResponse> {
    const res = await h.call(`/products${query}`, null);
    assert.equal(res.status, 200, `GET /products${query}`);
    return (await res.json()) as PublicProductListResponse;
  }
  const names = async (query = "") => (await list(query)).products.map((item) => item.name);
  const sortedNames = async (query = "") => (await names(query)).sort();
  async function detail(id: string): Promise<PublicProductDetail> {
    const res = await h.call(`/products/${id}`, null);
    assert.equal(res.status, 200);
    return (await res.json()) as PublicProductDetail;
  }
  async function facets(query = ""): Promise<CatalogFacetsResponse> {
    const res = await h.call(`/products/facets${query}`, null);
    assert.equal(res.status, 200);
    return (await res.json()) as CatalogFacetsResponse;
  }
  async function expectHidden(id: string): Promise<void> {
    const res = await h.call(`/products/${id}`, null);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: { code: "PRODUCT_NOT_FOUND" } });
    assert.equal((await list()).products.some((item) => item.id === id), false);
  }

  describe("access", () => {
    it("every route works without a token", async () => {
      const item = await product();
      assert.equal((await list()).total, 1);
      assert.equal((await detail(item.id)).id, item.id);
      await facets();
    });

    it("rate-limits by address: 429 with a code-only body", async () => {
      h.catalogRateLimiter = { hit: async () => ({ allowed: false, retryAfterSeconds: 60 }) };
      for (const path of ["/products", "/products/facets", `/products/${randomUUID()}`]) {
        const res = await h.call(path, null);
        assert.equal(res.status, 429);
        assert.deepEqual(await res.json(), { error: { code: "RATE_LIMITED" } });
      }
    });

    describe("customer address from the web server", () => {
      const ALICE = "203.0.113.9";
      const keysFor = async (headers: Record<string, string>) => {
        const keys: string[] = [];
        h.catalogRateLimiter = {
          hit: async (key) => {
            keys.push(key);
            return { allowed: true, retryAfterSeconds: 0 };
          },
        };
        const res = await h.call("/products", null, { headers });
        assert.equal(res.status, 200);
        return keys;
      };

      it("counts a server-rendered page against the customer, with the shared key", async () => {
        assert.deepEqual(await keysFor({ "x-chicman-internal-key": CATALOG_INTERNAL_KEY, "x-chicman-client-address": ALICE }), [`catalog:ip:${ALICE}`]);
      });

      it("keeps customers separate behind one web server", async () => {
        const blocked = "198.51.100.1";
        h.catalogRateLimiter = { hit: async (key) => ({ allowed: !key.endsWith(blocked), retryAfterSeconds: 60 }) };
        const call = (address: string) => h.call("/products", null, { headers: { "x-chicman-internal-key": CATALOG_INTERNAL_KEY, "x-chicman-client-address": address } });
        assert.equal((await call(blocked)).status, 429);
        assert.equal((await call(ALICE)).status, 200);
      });

      it("ignores the address without the right key, so a client cannot choose its limit", async () => {
        for (const headers of [{ "x-chicman-client-address": ALICE }, { "x-chicman-internal-key": "wrong", "x-chicman-client-address": ALICE }]) {
          const [key] = await keysFor(headers);
          assert.notEqual(key, `catalog:ip:${ALICE}`);
        }
      });

      it("ignores a value that is not an address, so it cannot shape the counter key", async () => {
        const [key] = await keysFor({ "x-chicman-internal-key": CATALOG_INTERNAL_KEY, "x-chicman-client-address": "x:user:someone" });
        assert.ok(key !== undefined && !key.includes("someone"));
      });
    });
  });

  describe("visibility", () => {
    it("drafts and archived products stay hidden; restored ones until published again", async () => {
      const draft = await product({ name: "Brouillon", publish: false });
      const live = await product({ name: "Publié" });
      await expectHidden(draft.id);
      assert.deepEqual(await names(), ["Publié"]);

      assert.equal((await post(`${base}/${live.id}/archive`, seller)).status, 200);
      await expectHidden(live.id);

      assert.equal((await post(`${base}/${live.id}/restore`, seller)).status, 200);
      await expectHidden(live.id);

      assert.equal((await post(`${base}/${live.id}/publish`, seller)).status, 200);
      assert.deepEqual(await names(), ["Publié"]);
    });

    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      it(`products of a ${status} shop are excluded, and facets too`, async () => {
        const item = await product({ variants: [{ size: "M" }] });
        await h.prisma.shop.update({ where: { id: shopId }, data: { status } });
        await expectHidden(item.id);
        assert.equal((await list()).total, 0);
        assert.deepEqual(await facets(), { sizes: [], colors: [] });
      });
    }

    it("a suspended shop's products return on reinstatement, without republishing", async () => {
      const item = await product();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      await expectHidden(item.id);
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "APPROVED" } });
      assert.equal((await detail(item.id)).id, item.id);
    });

    it("a published product whose images are all released is not displayed", async () => {
      const item = await product();
      await h.prisma.productImage.updateMany({ where: { productId: item.id }, data: { status: "RELEASED", releasedAt: new Date() } });
      await expectHidden(item.id);
    });

    it("a filter cannot widen visibility", async () => {
      await product({ name: "Caché", publish: false, category: "SHOES", price: "10.00", stock: 5 });
      assert.equal((await list("?category=SHOES&minPrice=1&maxPrice=20&availability=available")).total, 0);
    });
  });

  describe("availability", () => {
    it("zero stock stays listed and unavailable; replenishing restores it without republishing", async () => {
      const item = await product({ stock: 0 });
      let listed = (await list()).products[0];
      assert.equal(listed?.available, false);
      assert.equal((await detail(item.id)).available, false);
      assert.equal((await list("?availability=available")).total, 0);

      const res = await h.call(`${base}/${item.id}/stock`, seller.token, { method: "PUT", body: { stock: 2, expectedStock: 0 } });
      assert.equal(res.status, 200);
      listed = (await list()).products[0];
      assert.equal(listed?.available, true);
      assert.equal((await detail(item.id)).available, true);
      assert.equal((await list("?availability=available")).total, 1);
    });

    it("with variants, availability comes from the variants, in the list, details, and filter", async () => {
      const soldOut = await product({ name: "Épuisé", variants: [{ size: "M", stock: 0 }, { size: "L", stock: 0 }] });
      const inStock = await product({ name: "En stock", variants: [{ size: "M", stock: 0 }, { size: "L", stock: 4 }] });
      assert.deepEqual(await sortedNames("?availability=available"), ["En stock"]);
      assert.equal((await detail(soldOut.id)).available, false);
      const shown = await detail(inStock.id);
      assert.equal(shown.available, true);
      assert.deepEqual(shown.variants.map(({ size, available }) => [size, available]), [["M", false], ["L", true]]);
    });
  });

  describe("filters", () => {
    it("category", async () => {
      await product({ name: "Robe", category: "CLOTHING" });
      await product({ name: "Sandale", category: "SHOES" });
      await product({ name: "Sac", category: "FASHION_ACCESSORIES" });
      assert.deepEqual(await names("?category=SHOES"), ["Sandale"]);
      assert.deepEqual(await names("?category=FASHION_ACCESSORIES"), ["Sac"]);
      assert.equal((await list("?category=CLOTHING")).total, 1);
    });

    it("price bounds are inclusive and compared as decimals", async () => {
      await product({ name: "A", price: "99.99" });
      await product({ name: "B", price: "100.00" });
      await product({ name: "C", price: "1000.00" });
      await product({ name: "D", price: "1000.01" });
      assert.deepEqual(await sortedNames("?minPrice=100"), ["B", "C", "D"]);
      assert.deepEqual(await sortedNames("?maxPrice=1000"), ["A", "B", "C"]);
      assert.deepEqual(await sortedNames("?minPrice=100&maxPrice=1000.00"), ["B", "C"]);
      assert.deepEqual(await sortedNames("?minPrice=0"), ["A", "B", "C", "D"]);
    });

    it("size and color ignore case, match exactly, and combine on one variant", async () => {
      await product({ name: "M noir", variants: [{ size: "M", color: "Noir", stock: 1 }] });
      await product({ name: "Mélange", variants: [{ size: "M", color: "Rouge", stock: 1 }, { size: "L", color: "Noir", stock: 1 }] });
      await product({ name: "Sans variante" });

      assert.deepEqual(await sortedNames("?size=m"), ["M noir", "Mélange"]);
      assert.deepEqual(await sortedNames("?color=NOIR"), ["M noir", "Mélange"]);
      assert.deepEqual(await sortedNames("?size=M&color=Noir"), ["M noir"]);
      assert.equal((await list("?size=X")).total, 0);
      assert.equal((await list("?size=%25")).total, 0, "% is not a wildcard");
      assert.equal((await list("?size=_")).total, 0, "_ is not a wildcard");
    });

    it("size and color values containing pattern characters match only themselves", async () => {
      await product({ name: "Pourcent", variants: [{ size: "100%" }, { color: "a_b" }, { color: "c\\d" }] });
      await product({ name: "Autre", variants: [{ size: "100 cm" }, { color: "axb" }, { color: "cd" }] });
      assert.deepEqual(await names(`?size=${encodeURIComponent("100%")}`), ["Pourcent"]);
      assert.deepEqual(await names("?color=A_B"), ["Pourcent"]);
      assert.deepEqual(await names(`?color=${encodeURIComponent("c\\d")}`), ["Pourcent"]);
    });

    it("availability with a size or color requires that variant to be in stock", async () => {
      await product({ name: "M épuisé", variants: [{ size: "M", stock: 0 }, { size: "L", stock: 5 }] });
      await product({ name: "M dispo", variants: [{ size: "M", stock: 2 }] });
      assert.deepEqual(await sortedNames("?size=M"), ["M dispo", "M épuisé"]);
      assert.deepEqual(await sortedNames("?size=M&availability=available"), ["M dispo"]);
    });

    it("refuses invalid queries with a code-only 400", async () => {
      await product();
      for (const query of [
        "?category=BAGS",
        "?category=",
        "?sort=popular",
        "?sort=rating",
        "?minPrice=abc",
        "?minPrice=-1",
        "?minPrice=1.234",
        "?maxPrice=1e3",
        "?minPrice=20&maxPrice=10",
        "?availability=unavailable",
        "?page=0",
        "?page=1.5",
        "?pageSize=0",
        "?pageSize=51",
        "?size=",
        `?size=${"x".repeat(31)}`,
        "?size=M&size=L",
        "?color=a%00b",
        "?q=robe",
        "?status=DRAFT",
        "?shopId=abc",
      ]) {
        const res = await h.call(`/products${query}`, null);
        assert.equal(res.status, 400, query);
        assert.deepEqual(await res.json(), { error: { code: "BAD_REQUEST" } }, query);
      }
    });
  });

  describe("sorting and pagination", () => {
    it("newest follows publication, including a republished older product", async () => {
      const first = await product({ name: "Ancien" });
      await product({ name: "Récent" });
      await h.prisma.product.update({ where: { id: first.id }, data: { publishedAt: new Date(Date.now() - 86_400_000) } });
      assert.deepEqual(await names(), ["Récent", "Ancien"]);
      assert.deepEqual(await names("?sort=newest"), ["Récent", "Ancien"]);

      assert.equal((await post(`${base}/${first.id}/archive`, seller)).status, 200);
      assert.equal((await post(`${base}/${first.id}/restore`, seller)).status, 200);
      assert.equal((await post(`${base}/${first.id}/publish`, seller)).status, 200);
      assert.deepEqual(await names(), ["Ancien", "Récent"]);
    });

    it("price sorts numerically in both directions", async () => {
      await product({ name: "Neuf", price: "9.00" });
      await product({ name: "Mille", price: "1000.00" });
      await product({ name: "Cent", price: "100.50" });
      assert.deepEqual(await names("?sort=price_asc"), ["Neuf", "Cent", "Mille"]);
      assert.deepEqual(await names("?sort=price_desc"), ["Mille", "Cent", "Neuf"]);
    });

    it("pages stay complete and stable with equal prices, filters, and sorting", async () => {
      for (let index = 0; index < 7; index += 1) {
        await product({ name: `Égal ${index}`, price: "500.00", category: index === 6 ? "SHOES" : "CLOTHING" });
      }
      await product({ name: "Trop cher", price: "900.00" });

      for (const sort of ["price_asc", "price_desc", "newest"]) {
        const filter = `category=CLOTHING&maxPrice=600&sort=${sort}&pageSize=4`;
        const one = await list(`?${filter}&page=1`);
        const two = await list(`?${filter}&page=2`);
        const three = await list(`?${filter}&page=3`);
        assert.deepEqual([one.page, one.pageSize, one.total], [1, 4, 6]);
        assert.deepEqual([two.page, two.total], [2, 6]);
        assert.deepEqual([one.products.length, two.products.length, three.products.length], [4, 2, 0]);
        const ids = [...one.products, ...two.products].map((item) => item.id);
        assert.equal(new Set(ids).size, 6, "no repeat and no gap");
        assert.deepEqual((await list(`?${filter}&page=1`)).products.map((item) => item.id), one.products.map((item) => item.id));
      }
    });
  });

  describe("views", () => {
    it("a card has its image, name, price, shop, and availability, and nothing private", async () => {
      const item = await product({ name: "Robe", price: "1500.50", images: 2 });
      const listed = await list();
      const [card] = listed.products;
      assert.ok(card);
      assert.deepEqual(Object.keys(card).sort(), ["available", "brand", "category", "id", "mainImageUrl", "name", "price", "shop"]);
      assert.equal(card.id, item.id);
      assert.equal(card.price, "1500.50");
      assert.deepEqual(card.shop, { id: shopId, name: (await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).shopName });
      const [main] = await h.prisma.productImage.findMany({ where: { productId: item.id, status: "ACTIVE" }, orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
      assert.equal(card.mainImageUrl, `${MEDIA_BASE_URL}/${main?.objectKey}`);
    });

    it("details follow the display order, drop released images, and hide private data", async () => {
      const item = await product({ name: "Robe", images: 3, variants: [{ size: "M", color: "Noir", stock: 1 }, { size: "L", stock: 0 }] });
      const rows = await h.prisma.productImage.findMany({ where: { productId: item.id }, orderBy: { id: "asc" } });
      const [gone, ...kept] = rows;
      assert.ok(gone);
      await h.prisma.productImage.update({ where: { id: gone.id }, data: { status: "RELEASED", releasedAt: new Date() } });
      const reversed = [...kept].reverse();
      for (const [position, row] of reversed.entries()) await h.prisma.productImage.update({ where: { id: row.id }, data: { position } });

      const res = await h.call(`/products/${item.id}`, null);
      const raw = await res.text();
      const shown = JSON.parse(raw) as PublicProductDetail;

      assert.equal(shown.description, "Voile léger.\nPlusieurs coloris.");
      assert.deepEqual(shown.images.map((image) => image.id), reversed.map((row) => row.id));
      assert.equal(shown.mainImageUrl, shown.images[0]?.url);
      assert.deepEqual(Object.keys(shown.images[0] ?? {}).sort(), ["height", "id", "url", "width"]);
      assert.deepEqual(shown.variants.map(({ size, color, available }) => ({ size, color, available })), [
        { size: "M", color: "Noir", available: true },
        { size: "L", color: null, available: false },
      ]);
      assert.deepEqual(Object.keys(shown.variants[0] ?? {}).sort(), ["available", "color", "id", "size"]);
      assert.deepEqual(Object.keys(shown.shop).sort(), ["city", "description", "id", "logoUrl", "name"]);

      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      for (const secret of [shop.contactPhone, shop.address, shop.ownerUserId, seller.userId]) {
        assert.equal(raw.includes(secret), false);
      }
      for (const key of ['"stock"', '"status"', '"objectKey"', '"uploadId"', '"sizeBytes"', '"ownerUserId"', '"contactPhone"', '"whatsappPhone"']) {
        assert.equal(raw.includes(key), false, key);
      }
    });

    it("an unknown or malformed ID is a 404", async () => {
      await expectHidden(randomUUID());
      assert.equal((await h.call("/products/not-a-uuid", null)).status, 404);
    });
  });

  describe("facets", () => {
    it("lists public values once, ignoring case, in natural order and per category", async () => {
      await product({ category: "SHOES", variants: [{ size: "40" }, { size: "38" }, { size: "100" }, { color: "Noir" }] });
      await product({ category: "CLOTHING", variants: [{ size: "m", color: "noir" }, { size: "M", color: "Rouge" }] });
      await product({ category: "CLOTHING", publish: false, variants: [{ size: "XXL", color: "Caché" }] });

      const all = await facets();
      assert.deepEqual(all.sizes.filter((size) => /\d/.test(size)), ["38", "40", "100"]);
      assert.equal(all.sizes.filter((size) => size.toLowerCase() === "m").length, 1);
      assert.equal(all.colors.filter((color) => color.toLowerCase() === "noir").length, 1);
      assert.equal(all.sizes.includes("XXL"), false);
      assert.equal(all.colors.includes("Caché"), false);

      const shoes = await facets("?category=SHOES");
      assert.deepEqual(shoes, { sizes: ["38", "40", "100"], colors: ["Noir"] });
      assert.equal((await h.call("/products/facets?category=BAGS", null)).status, 400);
      assert.equal((await h.call("/products/facets?size=M", null)).status, 400);
    });
  });
});
