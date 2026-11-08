import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import {
  PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
  PRODUCT_MAX_IMAGES,
  productPriceSchema,
  type ProductImageUploadResponse,
  type SellerProductDetail,
  type SellerProductListResponse,
} from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { isStockAvailable, productAvailability } from "../src/modules/inventory/index.js";
import { ProductService, PUBLIC_PRODUCT_WHERE, runProductImageCleanup } from "../src/modules/products/index.js";
import { MEDIA_BASE_URL, ShopHarness, TEST_TIMING, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const PRODUCT = {
  name: "Melhfa en voile",
  description: "Voile léger.\nPlusieurs coloris.",
  category: "CLOTHING",
  brand: "Atelier Sahel",
  price: "1500.50",
  stock: 4,
};

const image = (width: number, height: number, format: "png" | "jpeg" | "webp" = "png") =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .toFormat(format)
    .toBuffer();

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
const HTML = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");

describe("product prices (spec 07, no floating point)", () => {
  it("normalizes decimal strings and refuses everything else", () => {
    assert.equal(productPriceSchema.parse("1500"), "1500.00");
    assert.equal(productPriceSchema.parse("1500.5"), "1500.50");
    assert.equal(productPriceSchema.parse("0.01"), "0.01");
    assert.equal(productPriceSchema.parse("9999999999.99"), "9999999999.99");
    for (const bad of [1500, 15.5, "0", "0.00", "-1", "1.234", "01", "1e3", "1,5", " 1", "", "12345678901", null]) {
      assert.equal(productPriceSchema.safeParse(bad).success, false, `accepted ${String(bad)}`);
    }
  });
});

describe("stock availability (spec 07)", () => {
  it("uses the product's stock without variants, and the variants' sum with them", () => {
    assert.deepEqual(productAvailability(3, []), { stock: 3, available: true });
    assert.deepEqual(productAvailability(0, []), { stock: 0, available: false });
    assert.deepEqual(productAvailability(9, [{ stock: 0 }, { stock: 2 }]), { stock: 2, available: true });
    assert.deepEqual(productAvailability(9, [{ stock: 0 }, { stock: 0 }]), { stock: 0, available: false });
    assert.deepEqual([isStockAvailable(0), isStockAvailable(1)], [false, true]);
  });
});

describe("product management (spec 07, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
  });

  const base = "/sellers/me/products";
  const post = (path: string, actor: Actor, body?: unknown) => h.call(path, actor.token, { method: "POST", body });
  const patch = (path: string, actor: Actor, body: unknown) => h.call(path, actor.token, { method: "PATCH", body });
  const put = (path: string, actor: Actor, body: unknown) => h.call(path, actor.token, { method: "PUT", body });
  const del = (path: string, actor: Actor) => h.call(path, actor.token, { method: "DELETE" });
  const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

  async function expectError(res: Response, status: number, errorCode?: string): Promise<void> {
    assert.equal(res.status, status);
    if (errorCode !== undefined) assert.equal(await code(res), errorCode);
  }

  async function ok(res: Response, status = 200): Promise<SellerProductDetail> {
    assert.equal(res.status, status);
    return (await res.json()) as SellerProductDetail;
  }

  const created = async (actor: Actor = seller, body: unknown = PRODUCT) => ok(await post(base, actor, body), 201);

  /** Requests an upload and places the bytes in staging, like the presigned PUT. */
  async function staged(productId: string, bytes: Buffer, contentType = "image/png", actor: Actor = seller): Promise<ProductImageUploadResponse> {
    const res = await post(`${base}/${productId}/images/uploads`, actor, { contentType, contentLength: bytes.byteLength });
    assert.equal(res.status, 201);
    const upload = (await res.json()) as ProductImageUploadResponse;
    h.storage.staging.set(stagingKey(productId, upload.uploadId), bytes);
    return upload;
  }

  const stagingKey = (productId: string, uploadId: string) => `product-images/${shopId}/${productId}/${uploadId}`;
  const complete = (productId: string, uploadId: string, actor: Actor = seller) =>
    post(`${base}/${productId}/images/uploads/${uploadId}/complete`, actor);

  async function withImage(productId: string, width = 120): Promise<SellerProductDetail> {
    const upload = await staged(productId, await image(width, 80));
    return ok(await complete(productId, upload.uploadId));
  }

  const snapshot = (productId: string) =>
    h.prisma.product.findUnique({ where: { id: productId }, include: { variants: { orderBy: { id: "asc" } }, images: { orderBy: { id: "asc" } } } });

  describe("authorization", () => {
    const body = PRODUCT;

    it("without a token → 401; no application user or a plain customer → 403", async () => {
      assert.equal((await h.call(base, null)).status, 401);
      const customer = await h.actor();
      assert.equal((await h.call(base, customer.token)).status, 403);
      assert.equal((await post(base, customer, body)).status, 403);
    });

    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      it(`a ${status} shop owner cannot manage products, even holding SELLER`, async () => {
        const owner = await h.actor(["CUSTOMER", "SELLER"]);
        await h.shopInStatus(status, owner);
        assert.equal((await h.call(base, owner.token)).status, 403);
        assert.equal((await post(base, owner, body)).status, 403);
        assert.equal(await h.prisma.product.count(), 0);
      });
    }

    it("an approved shop without the SELLER role, and SELLER without a shop, are refused", async () => {
      const noRole = await h.actor(["CUSTOMER"]);
      await h.shopInStatus("APPROVED", noRole);
      assert.equal((await post(base, noRole, body)).status, 403);
      const noShop = await h.actor(["CUSTOMER", "SELLER"]);
      assert.equal((await post(base, noShop, body)).status, 403);
    });

    it("a suspended seller keeps no access to existing products", async () => {
      const product = await created();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      for (const res of [
        await h.call(`${base}/${product.id}`, seller.token),
        await patch(`${base}/${product.id}`, seller, { name: "Autre" }),
        await post(`${base}/${product.id}/publish`, seller),
        await put(`${base}/${product.id}/stock`, seller, { stock: 1, expectedStock: 4 }),
      ]) {
        assert.equal(res.status, 403);
      }
    });

    it("the service re-checks the shop status in its transaction (suspension after the guard)", async () => {
      const product = await created();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      const service = new ProductService(h.prisma, MEDIA_BASE_URL);
      const who = { userId: seller.userId, shopId };
      await assert.rejects(service.publish(who, product.id), { status: 403 });
      await assert.rejects(service.create(who, { name: "x", description: "y", category: "SHOES", price: "1.00" }), { status: 403 });
      assert.equal((await snapshot(product.id))?.status, "DRAFT");
    });

    it("another seller gets 404 on every route and changes nothing", async () => {
      const product = await withImage((await created()).id);
      const variant = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 2 }), 201);
      const variantId = variant.variants[0]?.id ?? "";
      const imageId = product.images[0]?.id ?? "";
      const upload = await staged(product.id, await image(10, 10));
      const before = await snapshot(product.id);

      const { owner: other } = await h.shopInStatus("APPROVED");
      const attempts = [
        await h.call(`${base}/${product.id}`, other.token),
        await patch(`${base}/${product.id}`, other, { name: "Volé" }),
        await post(`${base}/${product.id}/publish`, other),
        await post(`${base}/${product.id}/archive`, other),
        await put(`${base}/${product.id}/stock`, other, { stock: 9, expectedStock: 0 }),
        await post(`${base}/${product.id}/variants`, other, { size: "L" }),
        await patch(`${base}/${product.id}/variants/${variantId}`, other, { size: "L" }),
        await del(`${base}/${product.id}/variants/${variantId}`, other),
        await put(`${base}/${product.id}/variants/${variantId}/stock`, other, { stock: 9, expectedStock: 2 }),
        await post(`${base}/${product.id}/images/uploads`, other, { contentType: "image/png", contentLength: 10 }),
        await complete(product.id, upload.uploadId, other),
        await put(`${base}/${product.id}/images/order`, other, { imageIds: [imageId] }),
        await del(`${base}/${product.id}/images/${imageId}`, other),
      ];
      for (const res of attempts) await expectError(res, 404, "PRODUCT_NOT_FOUND");
      assert.deepEqual(await snapshot(product.id), before);
    });

    it("lists only the seller's own products", async () => {
      await created();
      const { owner: other } = await h.shopInStatus("APPROVED");
      await created(other, { ...PRODUCT, name: "Autre boutique" });
      const list = (await (await h.call(base, seller.token)).json()) as SellerProductListResponse;
      assert.deepEqual(list.products.map((p) => p.name), [PRODUCT.name]);
      assert.equal(list.total, 1);
    });

    it("never trusts client-provided ownership or status", async () => {
      const { shopId: otherShop } = await h.shopInStatus("APPROVED");
      for (const extra of [{ shopId: otherShop }, { ownerUserId: seller.userId }, { status: "PUBLISHED" }, { publishedAt: new Date().toISOString() }, { id: randomUUID() }]) {
        await expectError(await post(base, seller, { ...PRODUCT, ...extra }), 400, "BAD_REQUEST");
      }
      const product = await created();
      assert.equal((await h.prisma.product.findUnique({ where: { id: product.id } }))?.shopId, shopId);
      await expectError(await patch(`${base}/${product.id}`, seller, { shopId: otherShop }), 400);
      await expectError(await patch(`${base}/${product.id}`, seller, { status: "PUBLISHED" }), 400);
      await expectError(await patch(`${base}/${product.id}`, seller, { stock: 100 }), 400);
    });

    it("malformed IDs are 404, not errors", async () => {
      await expectError(await h.call(`${base}/not-a-uuid`, seller.token), 404, "PRODUCT_NOT_FOUND");
      const product = await created();
      await expectError(await del(`${base}/${product.id}/variants/nope`, seller), 404, "PRODUCT_VARIANT_NOT_FOUND");
      await expectError(await del(`${base}/${product.id}/images/nope`, seller), 404, "PRODUCT_IMAGE_NOT_FOUND");
      await expectError(await complete(product.id, "nope"), 404, "PRODUCT_IMAGE_UPLOAD_NOT_FOUND");
    });
  });

  describe("product information", () => {
    it("creates a draft with the given fields and timestamps; the brand is optional", async () => {
      const product = await created();
      assert.equal(product.status, "DRAFT");
      assert.equal(product.name, PRODUCT.name);
      assert.equal(product.description, PRODUCT.description);
      assert.equal(product.category, "CLOTHING");
      assert.equal(product.brand, "Atelier Sahel");
      assert.equal(product.price, "1500.50");
      assert.equal(product.stock, 4);
      assert.equal(product.available, true);
      assert.ok(product.createdAt && product.updatedAt);
      const { brand: _brand, stock: _stock, ...minimal } = PRODUCT;
      const second = await created(seller, minimal);
      assert.equal(second.brand, null);
      assert.equal(second.stock, 0);
      assert.equal(second.available, false);
    });

    it("accepts the three categories only", async () => {
      for (const category of ["CLOTHING", "SHOES", "FASHION_ACCESSORIES"]) {
        assert.equal((await created(seller, { ...PRODUCT, category })).category, category);
      }
      for (const category of ["ELECTRONICS", "clothing", "", null, 1]) {
        await expectError(await post(base, seller, { ...PRODUCT, category }), 400);
      }
      await assert.rejects(
        h.prisma.$executeRaw`UPDATE "Product" SET "category" = 'ELECTRONICS'`,
        "the database refuses other categories",
      );
    });

    it("stores prices exactly and refuses numeric or invalid prices", async () => {
      const product = await created(seller, { ...PRODUCT, price: "9999999999.99" });
      assert.equal(product.price, "9999999999.99");
      const rows = await h.prisma.$queryRaw<{ price: string }[]>`SELECT "price"::text AS "price" FROM "Product" WHERE "id" = ${product.id}::uuid`;
      assert.equal(rows[0]?.price, "9999999999.99");
      const updated = await ok(await patch(`${base}/${product.id}`, seller, { price: "0.30" }));
      assert.equal(updated.price, "0.30");
      for (const price of [1500.5, 0, "0", "-1", "1.999", "abc", null]) {
        await expectError(await post(base, seller, { ...PRODUCT, price }), 400);
      }
      await assert.rejects(h.prisma.$executeRaw`UPDATE "Product" SET "price" = 0`, "the database refuses a zero price");
    });

    it("validates text: required, bounded, no control characters", async () => {
      for (const change of [{ name: "" }, { name: "   " }, { name: "x".repeat(151) }, { description: "" }, { description: "x".repeat(5001) }, { name: "a\u0000b" }, { brand: "" }]) {
        await expectError(await post(base, seller, { ...PRODUCT, ...change }), 400);
      }
      await expectError(await patch(`${base}/${(await created()).id}`, seller, {}), 400);
    });

    it("updates only the given fields; the brand can be cleared", async () => {
      const product = await created();
      const updated = await ok(await patch(`${base}/${product.id}`, seller, { name: "Nouveau", brand: null, category: "SHOES" }));
      assert.equal(updated.name, "Nouveau");
      assert.equal(updated.brand, null);
      assert.equal(updated.category, "SHOES");
      assert.equal(updated.price, "1500.50");
    });

    it("paginates and filters the seller's list by status", async () => {
      for (let i = 0; i < 3; i += 1) await created(seller, { ...PRODUCT, name: `P${i}` });
      const first = (await (await h.call(`${base}?page=1&pageSize=2`, seller.token)).json()) as SellerProductListResponse;
      assert.deepEqual(first.products.map((p) => p.name), ["P2", "P1"]);
      assert.equal(first.total, 3);
      const second = (await (await h.call(`${base}?page=2&pageSize=2`, seller.token)).json()) as SellerProductListResponse;
      assert.deepEqual(second.products.map((p) => p.name), ["P0"]);
      const drafts = (await (await h.call(`${base}?status=PUBLISHED`, seller.token)).json()) as SellerProductListResponse;
      assert.equal(drafts.total, 0);
      await expectError(await h.call(`${base}?status=NOPE`, seller.token), 400);
      await expectError(await h.call(`${base}?pageSize=51`, seller.token), 400);
      await expectError(await h.call(`${base}?shopId=x`, seller.token), 400);
    });
  });

  describe("variants", () => {
    it("supports size only, color only, and both, each with its own ID and stock", async () => {
      const product = await created();
      await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 3 }), 201);
      await ok(await post(`${base}/${product.id}/variants`, seller, { color: "Bleu", stock: 2 }), 201);
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "L", color: "Rouge" }), 201);
      assert.deepEqual(
        detail.variants.map((v) => [v.size, v.color, v.stock]),
        [["M", null, 3], [null, "Bleu", 2], ["L", "Rouge", 0]],
      );
      assert.equal(new Set(detail.variants.map((v) => v.id)).size, 3);
      assert.equal(detail.stock, 5);
      assert.equal(detail.variantCount, 3);
    });

    it("a variant needs an attribute, also after an update", async () => {
      const product = await created();
      await expectError(await post(`${base}/${product.id}/variants`, seller, { stock: 1 }), 400);
      await expectError(await post(`${base}/${product.id}/variants`, seller, { size: null, color: null }), 400);
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M" }), 201);
      const variantId = detail.variants[0]?.id ?? "";
      await expectError(await patch(`${base}/${product.id}/variants/${variantId}`, seller, { size: null }), 400, "PRODUCT_VARIANT_ATTRIBUTE_REQUIRED");
      const changed = await ok(await patch(`${base}/${product.id}/variants/${variantId}`, seller, { size: null, color: "Vert" }));
      assert.deepEqual([changed.variants[0]?.size, changed.variants[0]?.color], [null, "Vert"]);
    });

    it("refuses a duplicate, ignoring case, on creation, on update, and under concurrency", async () => {
      const product = await created();
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", color: "Bleu" }), 201);
      await expectError(await post(`${base}/${product.id}/variants`, seller, { size: "m", color: "bleu" }), 409, "PRODUCT_VARIANT_ALREADY_EXISTS");
      const second = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "L", color: "Bleu" }), 201);
      const secondId = second.variants.find((v) => v.size === "L")?.id ?? "";
      await expectError(await patch(`${base}/${product.id}/variants/${secondId}`, seller, { size: "M" }), 409, "PRODUCT_VARIANT_ALREADY_EXISTS");
      assert.ok(detail.variants[0]);
      const results = await Promise.all(Array.from({ length: 4 }, () => post(`${base}/${product.id}/variants`, seller, { size: "XL" })));
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
    });

    it("the same attributes may exist on another product", async () => {
      const [a, b] = [await created(), await created()];
      await ok(await post(`${base}/${a.id}/variants`, seller, { size: "M" }), 201);
      await ok(await post(`${base}/${b.id}/variants`, seller, { size: "M" }), 201);
    });

    it("a variant of another product of the same shop is not found", async () => {
      const [a, b] = [await created(), await created()];
      const detail = await ok(await post(`${base}/${a.id}/variants`, seller, { size: "M", stock: 1 }), 201);
      const variantId = detail.variants[0]?.id ?? "";
      await expectError(await put(`${base}/${b.id}/variants/${variantId}/stock`, seller, { stock: 9, expectedStock: 1 }), 404, "PRODUCT_VARIANT_NOT_FOUND");
      await expectError(await del(`${base}/${b.id}/variants/${variantId}`, seller), 404, "PRODUCT_VARIANT_NOT_FOUND");
      assert.equal((await h.prisma.productVariant.findUnique({ where: { id: variantId } }))?.stock, 1);
    });

    it("removes one variant without touching the others", async () => {
      const product = await created();
      await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 1 }), 201);
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "L", stock: 2 }), 201);
      const medium = detail.variants.find((v) => v.size === "M")?.id ?? "";
      const after = await ok(await del(`${base}/${product.id}/variants/${medium}`, seller));
      assert.deepEqual(after.variants.map((v) => [v.size, v.stock]), [["L", 2]]);
      assert.equal(after.stock, 2);
    });

    it("limits the number of variants", async () => {
      const product = await created();
      await h.prisma.productVariant.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ productId: product.id, size: `S${i}` })) });
      await expectError(await post(`${base}/${product.id}/variants`, seller, { size: "extra" }), 409, "PRODUCT_VARIANT_LIMIT_REACHED");
    });
  });

  describe("stock", () => {
    it("sets product stock when the expected value still holds", async () => {
      const product = await created();
      const updated = await ok(await put(`${base}/${product.id}/stock`, seller, { stock: 10, expectedStock: 4 }));
      assert.equal(updated.stock, 10);
      await expectError(await put(`${base}/${product.id}/stock`, seller, { stock: 11, expectedStock: 4 }), 409, "PRODUCT_STOCK_CONFLICT");
      assert.equal((await h.prisma.product.findUnique({ where: { id: product.id } }))?.stock, 10);
    });

    it("zero stock makes the product unavailable", async () => {
      const product = await created();
      const updated = await ok(await put(`${base}/${product.id}/stock`, seller, { stock: 0, expectedStock: 4 }));
      assert.equal(updated.available, false);
    });

    it("refuses negative, fractional, excessive, and non-numeric stock everywhere", async () => {
      const product = await created();
      const withVariant = await created();
      const detail = await ok(await post(`${base}/${withVariant.id}/variants`, seller, { size: "M", stock: 1 }), 201);
      const variantId = detail.variants[0]?.id ?? "";
      for (const stock of [-1, 1.5, 1_000_001, "5", null]) {
        await expectError(await put(`${base}/${product.id}/stock`, seller, { stock, expectedStock: 4 }), 400);
        await expectError(await put(`${base}/${withVariant.id}/variants/${variantId}/stock`, seller, { stock, expectedStock: 1 }), 400);
        await expectError(await post(base, seller, { ...PRODUCT, stock }), 400);
        await expectError(await post(`${base}/${withVariant.id}/variants`, seller, { size: "L", stock }), 400);
      }
      await expectError(await put(`${base}/${product.id}/stock`, seller, { stock: 1 }), 400);
      assert.equal((await h.prisma.product.findUnique({ where: { id: product.id } }))?.stock, 4);
    });

    it("the database refuses negative stock", async () => {
      const product = await created();
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M" }), 201);
      await assert.rejects(h.prisma.$executeRaw`UPDATE "Product" SET "stock" = -1 WHERE "id" = ${product.id}::uuid`);
      await assert.rejects(h.prisma.$executeRaw`UPDATE "ProductVariant" SET "stock" = -1 WHERE "id" = ${detail.variants[0]?.id ?? ""}::uuid`);
    });

    it("of concurrent updates from the same value, exactly one applies", async () => {
      const product = await created();
      const results = await Promise.all([10, 20, 30, 40].map((stock) => put(`${base}/${product.id}/stock`, seller, { stock, expectedStock: 4 })));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409]);
      const winner = results.findIndex((r) => r.status === 200);
      assert.equal((await h.prisma.product.findUnique({ where: { id: product.id } }))?.stock, [10, 20, 30, 40][winner]);
    });

    it("the first variant moves stock to the variants, and an old value never returns", async () => {
      const product = await created();
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 2 }), 201);
      assert.equal(detail.stock, 2);
      assert.equal((await h.prisma.product.findUnique({ where: { id: product.id } }))?.stock, 0);
      await expectError(await put(`${base}/${product.id}/stock`, seller, { stock: 9, expectedStock: 0 }), 409, "PRODUCT_STOCK_MANAGED_BY_VARIANTS");
      const variantId = detail.variants[0]?.id ?? "";
      const changed = await ok(await put(`${base}/${product.id}/variants/${variantId}/stock`, seller, { stock: 7, expectedStock: 2 }));
      assert.equal(changed.variants[0]?.stock, 7);
      const removed = await ok(await del(`${base}/${product.id}/variants/${variantId}`, seller));
      assert.deepEqual([removed.stock, removed.available, removed.variantCount], [0, false, 0]);
      assert.equal((await ok(await put(`${base}/${product.id}/stock`, seller, { stock: 3, expectedStock: 0 }))).stock, 3);
    });

    it("a product with variants is unavailable only when every variant is at zero", async () => {
      const product = await created();
      await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 0 }), 201);
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "L", stock: 1 }), 201);
      assert.equal(detail.available, true);
      const large = detail.variants.find((v) => v.size === "L")?.id ?? "";
      assert.equal((await ok(await put(`${base}/${product.id}/variants/${large}/stock`, seller, { stock: 0, expectedStock: 1 }))).available, false);
    });
  });

  describe("lifecycle", () => {
    it("publishing needs an image; then DRAFT → PUBLISHED → ARCHIVED, each once", async () => {
      const product = await created();
      await expectError(await post(`${base}/${product.id}/publish`, seller), 409, "PRODUCT_PUBLISH_REQUIRES_IMAGE");
      await withImage(product.id);
      const published = await ok(await post(`${base}/${product.id}/publish`, seller));
      assert.equal(published.status, "PUBLISHED");
      assert.ok(published.publishedAt);
      await expectError(await post(`${base}/${product.id}/publish`, seller), 409, "PRODUCT_STATUS_CONFLICT");
      const archived = await ok(await post(`${base}/${product.id}/archive`, seller));
      assert.equal(archived.status, "ARCHIVED");
      assert.ok(archived.archivedAt);
      await expectError(await post(`${base}/${product.id}/archive`, seller), 409, "PRODUCT_STATUS_CONFLICT");
      await expectError(await post(`${base}/${product.id}/publish`, seller), 409, "PRODUCT_STATUS_CONFLICT");
    });

    it("a draft can be archived directly; a published product with zero stock is allowed", async () => {
      const draft = await created();
      assert.equal((await ok(await post(`${base}/${draft.id}/archive`, seller))).status, "ARCHIVED");
      const empty = await created(seller, { ...PRODUCT, stock: 0 });
      await withImage(empty.id);
      const published = await ok(await post(`${base}/${empty.id}/publish`, seller));
      assert.deepEqual([published.status, published.available], ["PUBLISHED", false]);
    });

    it("a published product can be edited", async () => {
      const product = await created();
      await withImage(product.id);
      await ok(await post(`${base}/${product.id}/publish`, seller));
      const updated = await ok(await patch(`${base}/${product.id}`, seller, { price: "2000" }));
      assert.deepEqual([updated.status, updated.price], ["PUBLISHED", "2000.00"]);
    });

    it("archiving keeps the row, variants, images, and their objects; the product becomes read-only", async () => {
      const product = await created();
      const withImg = await withImage(product.id);
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 3 }), 201);
      const variantId = detail.variants[0]?.id ?? "";
      const imageId = withImg.images[0]?.id ?? "";
      await ok(await post(`${base}/${product.id}/archive`, seller));
      const before = await snapshot(product.id);
      assert.equal(before?.variants.length, 1);
      assert.equal(before?.images[0]?.status, "ACTIVE");

      for (const res of [
        await patch(`${base}/${product.id}`, seller, { name: "x" }),
        await put(`${base}/${product.id}/variants/${variantId}/stock`, seller, { stock: 1, expectedStock: 3 }),
        await post(`${base}/${product.id}/variants`, seller, { size: "L" }),
        await patch(`${base}/${product.id}/variants/${variantId}`, seller, { size: "L" }),
        await del(`${base}/${product.id}/variants/${variantId}`, seller),
        await del(`${base}/${product.id}/images/${imageId}`, seller),
        await put(`${base}/${product.id}/images/order`, seller, { imageIds: [imageId] }),
        await post(`${base}/${product.id}/images/uploads`, seller, { contentType: "image/png", contentLength: 10 }),
      ]) {
        await expectError(res, 409, "PRODUCT_ARCHIVED");
      }
      assert.deepEqual(await snapshot(product.id), before);

      await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
      assert.equal(h.storage.media.size, 1, "the cleanup job keeps an archived product's image");
      assert.equal((await ok(await h.call(`${base}/${product.id}`, seller.token))).status, "ARCHIVED");
    });

    it("has no delete route, and the database refuses to delete a product's shop", async () => {
      const product = await created();
      assert.equal((await del(`${base}/${product.id}`, seller)).status, 404);
      assert.ok(await h.prisma.product.findUnique({ where: { id: product.id } }));
      await assert.rejects(h.prisma.shop.delete({ where: { id: shopId } }));
    });

    it("concurrent publish and archive leave one consistent state", async () => {
      const product = await created();
      await withImage(product.id);
      const results = await Promise.all([post(`${base}/${product.id}/publish`, seller), post(`${base}/${product.id}/archive`, seller)]);
      assert.ok(results.some((r) => r.status === 200));
      const row = await h.prisma.product.findUnique({ where: { id: product.id } });
      assert.equal(row?.status === "ARCHIVED", row?.archivedAt !== null);
      assert.ok(row?.status === "ARCHIVED" || row?.status === "PUBLISHED");
    });
  });

  describe("restore", () => {
    const restore = (id: string, actor: Actor = seller) => post(`${base}/${id}/restore`, actor);
    const eligible = async () => (await h.prisma.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: { id: true } })).map((p) => p.id);

    /** A published product with an image and a variant, then archived. */
    async function archivedProduct(): Promise<SellerProductDetail> {
      const product = await created();
      await withImage(product.id);
      await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", color: "Bleu", stock: 3 }), 201);
      await ok(await post(`${base}/${product.id}/publish`, seller));
      return ok(await post(`${base}/${product.id}/archive`, seller));
    }

    it("returns an archived product to DRAFT and preserves its information, images, variants, and stock", async () => {
      const archived = await archivedProduct();
      await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
      const restored = await ok(await restore(archived.id));
      assert.equal(restored.status, "DRAFT");
      assert.equal(restored.archivedAt, null);
      const { status: _a, archivedAt: _b, updatedAt: _c, ...before } = archived;
      const { status: _d, archivedAt: _e, updatedAt: _f, ...after } = restored;
      assert.deepEqual(after, before);
      assert.equal(h.storage.media.size, 1, "the image object is kept");
    });

    it("never publishes: the product stays non-public until published again under the normal rules", async () => {
      const archived = await archivedProduct();
      assert.deepEqual(await eligible(), [], "archived products are excluded");
      await ok(await restore(archived.id));
      assert.deepEqual(await eligible(), [], "a restored product is not public");
      const published = await ok(await post(`${base}/${archived.id}/publish`, seller));
      assert.equal(published.status, "PUBLISHED");
      assert.notEqual(published.publishedAt, null);
      assert.deepEqual(await eligible(), [archived.id]);
    });

    it("a restored product without an image still cannot be published", async () => {
      const product = await created();
      await ok(await post(`${base}/${product.id}/archive`, seller));
      await ok(await restore(product.id));
      await expectError(await post(`${base}/${product.id}/publish`, seller), 409, "PRODUCT_PUBLISH_REQUIRES_IMAGE");
    });

    it("a restored product is editable again", async () => {
      const archived = await archivedProduct();
      await expectError(await patch(`${base}/${archived.id}`, seller, { name: "x" }), 409, "PRODUCT_ARCHIVED");
      await ok(await restore(archived.id));
      assert.equal((await ok(await patch(`${base}/${archived.id}`, seller, { name: "De retour" }))).name, "De retour");
      const variantId = archived.variants[0]?.id ?? "";
      assert.equal((await ok(await put(`${base}/${archived.id}/variants/${variantId}/stock`, seller, { stock: 8, expectedStock: 3 }))).stock, 8);
    });

    it("applies only to archived products", async () => {
      const draft = await created();
      await expectError(await restore(draft.id), 409, "PRODUCT_STATUS_CONFLICT");
      await withImage(draft.id);
      await ok(await post(`${base}/${draft.id}/publish`, seller));
      await expectError(await restore(draft.id), 409, "PRODUCT_STATUS_CONFLICT");
      assert.equal((await h.prisma.product.findUnique({ where: { id: draft.id } }))?.status, "PUBLISHED");
    });

    it("another seller gets 404, and a customer or anonymous caller is refused", async () => {
      const archived = await archivedProduct();
      const { owner: other } = await h.shopInStatus("APPROVED");
      await expectError(await restore(archived.id, other), 404, "PRODUCT_NOT_FOUND");
      assert.equal((await restore(archived.id, await h.actor())).status, 403);
      assert.equal((await h.call(`${base}/${archived.id}/restore`, null, { method: "POST" })).status, 401);
      await expectError(await h.call(`${base}/not-a-uuid/restore`, seller.token, { method: "POST" }), 404, "PRODUCT_NOT_FOUND");
      assert.equal((await h.prisma.product.findUnique({ where: { id: archived.id } }))?.status, "ARCHIVED");
    });

    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      it(`a ${status} shop cannot restore`, async () => {
        const archived = await archivedProduct();
        await h.prisma.shop.update({ where: { id: shopId }, data: { status } });
        assert.equal((await restore(archived.id)).status, 403);
        assert.equal((await h.prisma.product.findUnique({ where: { id: archived.id } }))?.status, "ARCHIVED");
      });
    }

    it("the service re-checks the shop status in its transaction", async () => {
      const archived = await archivedProduct();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      const service = new ProductService(h.prisma, MEDIA_BASE_URL);
      await assert.rejects(service.restore({ userId: seller.userId, shopId }, archived.id), { status: 403 });
      assert.equal((await h.prisma.product.findUnique({ where: { id: archived.id } }))?.status, "ARCHIVED");
    });

    it("of concurrent restores, exactly one applies", async () => {
      const archived = await archivedProduct();
      const results = await Promise.all(Array.from({ length: 4 }, () => restore(archived.id)));
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409, 409]);
    });

    it("can be archived and restored again", async () => {
      const archived = await archivedProduct();
      await ok(await restore(archived.id));
      const again = await ok(await post(`${base}/${archived.id}/archive`, seller));
      assert.equal(again.status, "ARCHIVED");
      assert.equal((await ok(await restore(archived.id))).status, "DRAFT");
    });
  });

  describe("availability and visibility are separate", () => {
    const eligible = async () => (await h.prisma.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: { id: true } })).map((p) => p.id);

    it("a published product stays visible at zero stock, and returns to available without republishing", async () => {
      const product = await created();
      await withImage(product.id);
      const published = await ok(await post(`${base}/${product.id}/publish`, seller));
      const empty = await ok(await put(`${base}/${product.id}/stock`, seller, { stock: 0, expectedStock: 4 }));
      assert.deepEqual([empty.status, empty.available, empty.stock], ["PUBLISHED", false, 0]);
      assert.deepEqual(await eligible(), [product.id]);
      const refilled = await ok(await put(`${base}/${product.id}/stock`, seller, { stock: 2, expectedStock: 0 }));
      assert.deepEqual([refilled.status, refilled.available], ["PUBLISHED", true]);
      assert.equal(refilled.publishedAt, published.publishedAt, "no new publication");
      assert.deepEqual(await eligible(), [product.id]);
    });

    it("each variant reports its own availability; the product is unavailable only when all are at zero", async () => {
      const product = await created();
      await withImage(product.id);
      await ok(await post(`${base}/${product.id}/variants`, seller, { size: "M", stock: 0 }), 201);
      const detail = await ok(await post(`${base}/${product.id}/variants`, seller, { size: "L", stock: 1 }), 201);
      assert.deepEqual(detail.variants.map((v) => [v.size, v.available]), [["M", false], ["L", true]]);
      assert.equal(detail.available, true);
      await ok(await post(`${base}/${product.id}/publish`, seller));
      const large = detail.variants[1]?.id ?? "";
      const empty = await ok(await put(`${base}/${product.id}/variants/${large}/stock`, seller, { stock: 0, expectedStock: 1 }));
      assert.deepEqual([empty.status, empty.available], ["PUBLISHED", false]);
      assert.deepEqual(await eligible(), [product.id]);
      const refilled = await ok(await put(`${base}/${product.id}/variants/${large}/stock`, seller, { stock: 5, expectedStock: 0 }));
      assert.deepEqual([refilled.status, refilled.available, refilled.variants[1]?.available, refilled.variants[0]?.available], ["PUBLISHED", true, true, false]);
    });
  });

  describe("public visibility", () => {
    const visible = async () =>
      (await h.prisma.product.findMany({ where: PUBLIC_PRODUCT_WHERE, select: { id: true } })).map((p) => p.id);

    it("no public route exposes products yet", async () => {
      const product = await created();
      for (const path of ["/products", `/products/${product.id}`, base, `${base}/${product.id}`]) {
        const res = await h.call(path, null);
        assert.ok(res.status === 404 || res.status === 401, `${path} → ${res.status}`);
      }
    });

    it("only published products of approved shops, with an image, are eligible", async () => {
      const draft = await created();
      await withImage(draft.id);
      const archived = await created();
      await withImage(archived.id);
      await ok(await post(`${base}/${archived.id}/archive`, seller));
      const published = await created();
      await withImage(published.id);
      await ok(await post(`${base}/${published.id}/publish`, seller));
      assert.deepEqual(await visible(), [published.id]);
    });

    it("an out-of-stock published product stays eligible, identified as unavailable", async () => {
      const product = await created(seller, { ...PRODUCT, stock: 0 });
      await withImage(product.id);
      await ok(await post(`${base}/${product.id}/publish`, seller));
      assert.deepEqual(await visible(), [product.id]);
    });

    for (const status of ["PENDING", "REJECTED", "SUSPENDED"] as const) {
      it(`a ${status} shop's published products are excluded, and return when approved again`, async () => {
        const product = await created();
        await withImage(product.id);
        await ok(await post(`${base}/${product.id}/publish`, seller));
        await h.prisma.shop.update({ where: { id: shopId }, data: { status } });
        assert.deepEqual(await visible(), []);
        assert.equal((await h.prisma.product.findUnique({ where: { id: product.id } }))?.status, "PUBLISHED");
        await h.prisma.shop.update({ where: { id: shopId }, data: { status: "APPROVED" } });
        assert.deepEqual(await visible(), [product.id]);
      });
    }

    it("a published product without an active image is excluded", async () => {
      const product = await created();
      await withImage(product.id);
      await ok(await post(`${base}/${product.id}/publish`, seller));
      await h.prisma.productImage.updateMany({ where: { productId: product.id }, data: { status: "RELEASED" } });
      assert.deepEqual(await visible(), []);
    });
  });

  describe("images", () => {
    it("presigns a staging PUT, verifies on completion, and publishes a new public object", async () => {
      const product = await created();
      const png = await image(120, 80);
      const upload = await staged(product.id, png);
      assert.equal(upload.method, "PUT");
      assert.deepEqual(upload.headers, { "Content-Type": "image/png", "Content-Length": String(png.byteLength) });
      assert.deepEqual(h.storage.presigned.at(-1), {
        key: stagingKey(product.id, upload.uploadId),
        contentType: "image/png",
        contentLength: png.byteLength,
        expiresIn: PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
      });
      const detail = await ok(await complete(product.id, upload.uploadId));
      const shown = detail.images[0];
      assert.ok(shown);
      assert.equal(detail.mainImageUrl, shown.url);
      assert.ok(shown.url.startsWith(`${MEDIA_BASE_URL}/product-images/${shopId}/${product.id}/`));
      assert.ok(!shown.url.includes("X-Amz"));
      const objectKey = shown.url.slice(MEDIA_BASE_URL.length + 1);
      const stored = h.storage.media.get(objectKey);
      assert.equal(stored?.contentType, "image/png");
      assert.deepEqual([shown.width, shown.height, shown.contentType, shown.sizeBytes, shown.position], [120, 80, "image/png", stored?.body.byteLength, 0]);
    });

    it("stores no presigned URL: only the object key", async () => {
      const product = await created();
      await withImage(product.id);
      const rows = await h.prisma.$queryRaw<{ row: string }[]>`
        SELECT i::text AS "row" FROM "ProductImage" i UNION ALL SELECT u::text FROM "ProductImageUpload" u`;
      assert.equal(rows.length, 2);
      for (const { row } of rows) assert.ok(!row.includes("X-Amz") && !row.includes("https://"));
    });

    it("accepts JPEG, PNG, and WebP up to 1024 × 1024", async () => {
      const product = await created();
      for (const format of ["jpeg", "png", "webp"] as const) {
        const upload = await staged(product.id, await image(1024, 1024, format), `image/${format}`);
        await ok(await complete(product.id, upload.uploadId));
      }
      const detail = await ok(await h.call(`${base}/${product.id}`, seller.token));
      assert.deepEqual(detail.images.map((i) => i.contentType), ["image/jpeg", "image/png", "image/webp"]);
      assert.deepEqual(detail.images.map((i) => i.position), [0, 1, 2]);
    });

    it("refuses SVG, other types, and oversized requests before presigning", async () => {
      const product = await created();
      for (const body of [
        { contentType: "image/svg+xml", contentLength: 100 },
        { contentType: "image/gif", contentLength: 100 },
        { contentType: "image/png", contentLength: 15_728_641 },
        { contentType: "image/png", contentLength: 0 },
        { contentType: "image/png", contentLength: 10, key: "../other" },
      ]) {
        await expectError(await post(`${base}/${product.id}/images/uploads`, seller, body), 400);
      }
      assert.equal(h.storage.presigned.length, 0);
    });

    it("verifies the real content: spoofed types, bad images, and oversized files publish nothing", async () => {
      const product = await created();
      const png = await image(200, 200);
      const corrupt = Buffer.from(png);
      corrupt.fill(0, 40, png.length - 20);
      const cases: [Buffer, string, string][] = [
        [SVG, "image/png", "PRODUCT_IMAGE_UNSUPPORTED_TYPE"],
        [HTML, "image/jpeg", "PRODUCT_IMAGE_UNSUPPORTED_TYPE"],
        [await image(10, 10, "png"), "image/jpeg", "PRODUCT_IMAGE_UNSUPPORTED_TYPE"],
        [await image(8001, 8000), "image/png", "PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS"],
        [corrupt, "image/png", "PRODUCT_IMAGE_INVALID"],
        [Buffer.alloc(15_728_641, 0xff), "image/png", "PRODUCT_IMAGE_TOO_LARGE"],
      ];
      for (const [bytes, type, expected] of cases) {
        const res = await post(`${base}/${product.id}/images/uploads`, seller, { contentType: type, contentLength: Math.min(bytes.byteLength, 15_728_640) });
        const upload = (await res.json()) as ProductImageUploadResponse;
        h.storage.staging.set(stagingKey(product.id, upload.uploadId), bytes);
        await expectError(await complete(product.id, upload.uploadId), 422, expected);
        // A repeated completion gives the same terminal answer.
        await expectError(await complete(product.id, upload.uploadId), 422, expected);
      }
      assert.equal(h.storage.media.size, 0);
      assert.equal(await h.prisma.productImage.count(), 0);
    });

    it("not uploaded yet → 422 and retryable", async () => {
      const product = await created();
      const res = await post(`${base}/${product.id}/images/uploads`, seller, { contentType: "image/png", contentLength: 100 });
      const upload = (await res.json()) as ProductImageUploadResponse;
      await expectError(await complete(product.id, upload.uploadId), 422, "PRODUCT_IMAGE_NOT_UPLOADED");
      h.storage.staging.set(stagingKey(product.id, upload.uploadId), await image(20, 20));
      assert.equal((await ok(await complete(product.id, upload.uploadId))).images.length, 1);
    });

    it("completion is idempotent, also under concurrency: one image, one object", async () => {
      const product = await created();
      const upload = await staged(product.id, await image(60, 60));
      const results = await Promise.all(Array.from({ length: 5 }, () => complete(product.id, upload.uploadId)));
      assert.ok(results.some((r) => r.status === 200));
      for (const res of results) assert.ok(res.status === 200 || res.status === 409, `status ${res.status}`);
      const repeated = await ok(await complete(product.id, upload.uploadId));
      assert.equal(repeated.images.length, 1);
      assert.equal(h.storage.media.size, 1);
      assert.equal(await h.prisma.productImage.count(), 1);
    });

    it("an upload belongs to its product: another product of the shop cannot complete it", async () => {
      const [a, b] = [await created(), await created()];
      const upload = await staged(a.id, await image(10, 10));
      await expectError(await complete(b.id, upload.uploadId), 404, "PRODUCT_IMAGE_UPLOAD_NOT_FOUND");
      assert.equal((await ok(await complete(a.id, upload.uploadId))).images.length, 1);
    });

    it("every image has its own key under its product: products never share objects", async () => {
      const [a, b] = [await created(), await created()];
      const first = await withImage(a.id);
      const second = await withImage(b.id);
      const third = await withImage(a.id);
      const urls = [first.images[0]?.url, second.images[0]?.url, third.images[1]?.url];
      assert.equal(new Set(urls).size, 3);
      assert.ok(second.images[0]?.url.includes(`/${b.id}/`));
      assert.ok(third.images[1]?.url.includes(`/${a.id}/`));
      assert.equal(h.storage.media.size, 3);
    });

    it("limits a product's images, on request and at commit", async () => {
      const product = await created();
      const racing = await staged(product.id, await image(10, 10));
      for (let i = 0; i < PRODUCT_MAX_IMAGES; i += 1) await withImage(product.id);
      await expectError(await post(`${base}/${product.id}/images/uploads`, seller, { contentType: "image/png", contentLength: 10 }), 409, "PRODUCT_IMAGE_LIMIT_REACHED");
      const objects = h.storage.media.size;
      await expectError(await complete(product.id, racing.uploadId), 409, "PRODUCT_IMAGE_LIMIT_REACHED");
      await expectError(await complete(product.id, racing.uploadId), 409, "PRODUCT_IMAGE_LIMIT_REACHED");
      assert.equal(h.storage.media.size, objects, "the refused image's object was deleted");
      assert.equal(await h.prisma.productImage.count({ where: { productId: product.id, status: "ACTIVE" } }), PRODUCT_MAX_IMAGES);
    });

    it("reorders with the full list only; the first image becomes the main image", async () => {
      const product = await created();
      await withImage(product.id);
      await withImage(product.id);
      const detail = await withImage(product.id);
      const [a, b, c] = detail.images.map((i) => i.id) as [string, string, string];
      const reordered = await ok(await put(`${base}/${product.id}/images/order`, seller, { imageIds: [c, a, b] }));
      assert.deepEqual(reordered.images.map((i) => i.id), [c, a, b]);
      assert.equal(reordered.mainImageUrl, reordered.images[0]?.url);
      await expectError(await put(`${base}/${product.id}/images/order`, seller, { imageIds: [a, b] }), 400, "PRODUCT_IMAGE_ORDER_INVALID");
      await expectError(await put(`${base}/${product.id}/images/order`, seller, { imageIds: [a, b, randomUUID()] }), 400, "PRODUCT_IMAGE_ORDER_INVALID");
      await expectError(await put(`${base}/${product.id}/images/order`, seller, { imageIds: [a, a, b] }), 400);
    });

    it("removes an image; the cleanup job deletes only its bytes", async () => {
      const product = await created();
      await withImage(product.id);
      const detail = await withImage(product.id);
      const [first, second] = detail.images as [(typeof detail.images)[0], (typeof detail.images)[0]];
      const after = await ok(await del(`${base}/${product.id}/images/${first.id}`, seller));
      assert.deepEqual(after.images.map((i) => i.id), [second.id]);
      assert.equal(after.mainImageUrl, second.url);
      assert.equal(h.storage.media.size, 2, "bytes stay until the job runs");
      await expectError(await del(`${base}/${product.id}/images/${first.id}`, seller), 404, "PRODUCT_IMAGE_NOT_FOUND");
      const result = await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
      assert.equal(result.deletedImages, 1);
      assert.deepEqual([...h.storage.media.keys()], [second.url.slice(MEDIA_BASE_URL.length + 1)]);
    });

    it("a published product keeps its last image; a draft may lose it", async () => {
      const product = await created();
      const detail = await withImage(product.id);
      await ok(await post(`${base}/${product.id}/publish`, seller));
      const imageId = detail.images[0]?.id ?? "";
      await expectError(await del(`${base}/${product.id}/images/${imageId}`, seller), 409, "PRODUCT_LAST_IMAGE_REQUIRED");
      const draft = await created();
      const draftDetail = await withImage(draft.id);
      assert.equal((await ok(await del(`${base}/${draft.id}/images/${draftDetail.images[0]?.id ?? ""}`, seller))).images.length, 0);
    });

    it("rate-limits upload requests", async () => {
      const product = await created();
      let last = 0;
      for (let i = 0; i <= 60; i += 1) {
        last = (await post(`${base}/${product.id}/images/uploads`, seller, { contentType: "image/png", contentLength: 10 })).status;
      }
      assert.equal(last, 429);
    });

    describe("normalization", () => {
      const EXIF = { IFD0: { Make: "SecretMake", Model: "SecretModel" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "18/1 5/1 0/1" } };
      /** A phone-like photo: over the 2 MB public limit, 12 MP, with GPS and device metadata. */
      const phonePhoto = () =>
        sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 120, g: 120, b: 120 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
          .withExif(EXIF)
          .jpeg({ quality: 92 })
          .toBuffer();
      const storedKey = (detail: SellerProductDetail, index = 0) => (detail.images[index]?.url ?? "").slice(MEDIA_BASE_URL.length + 1);

      async function assertNormalized(body: Buffer, width: number, height: number): Promise<void> {
        const meta = await sharp(body).metadata();
        assert.deepEqual([meta.format, meta.width, meta.height, meta.exif, meta.icc, meta.xmp], ["jpeg", width, height, undefined, undefined, undefined]);
        assert.ok(body.byteLength <= 2_097_152, `${body.byteLength} bytes`);
        for (const secret of ["SecretMake", "SecretModel", "Exif"]) assert.ok(!body.includes(secret), `${secret} survived`);
      }

      it("a phone photo over 2 MB is accepted; only the normalized image becomes public", async () => {
        const product = await created();
        const photo = await phonePhoto();
        assert.ok(photo.byteLength > 2_097_152, `fixture is ${photo.byteLength} bytes`);
        assert.ok(photo.includes("SecretModel"));
        const upload = await staged(product.id, photo, "image/jpeg");
        const detail = await ok(await complete(product.id, upload.uploadId));
        const key = storedKey(detail);
        assert.ok(key.endsWith(".jpg"));
        const stored = h.storage.media.get(key);
        assert.ok(stored);
        assert.equal(stored.contentType, "image/jpeg");
        await assertNormalized(stored.body, 1024, 768);
        assert.ok(!stored.body.equals(photo));
        const shown = detail.images[0];
        assert.deepEqual([shown?.width, shown?.height, shown?.sizeBytes], [1024, 768, stored.body.byteLength]);
        const row = await h.prisma.productImage.findFirst({ where: { uploadId: upload.uploadId } });
        assert.deepEqual([row?.width, row?.height, row?.sizeBytes], [1024, 768, stored.body.byteLength]);
      });

      it("accepts a declared size up to 15 MB, and the database agrees", async () => {
        const product = await created();
        assert.equal((await post(`${base}/${product.id}/images/uploads`, seller, { contentType: "image/jpeg", contentLength: 15_728_640 })).status, 201);
      });

      it("the original leaves staging once finished, and is never copied to media", async () => {
        const product = await created();
        const photo = await phonePhoto();
        const upload = await staged(product.id, photo, "image/jpeg");
        await ok(await complete(product.id, upload.uploadId));
        await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        assert.ok(!h.storage.staging.has(stagingKey(product.id, upload.uploadId)));
        for (const { body } of h.storage.media.values()) assert.ok(!body.includes("SecretModel"));
      });

      it("a repeated completion does not process or publish again", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        const first = await ok(await complete(product.id, upload.uploadId));
        const second = await ok(await complete(product.id, upload.uploadId));
        assert.deepEqual(second.images, first.images);
        assert.equal(h.storage.media.size, 1);
        assert.equal(await h.prisma.productImage.count({ where: { uploadId: upload.uploadId } }), 1);
      });

      it("concurrent completions publish one normalized object", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        const results = await Promise.all(Array.from({ length: 4 }, () => complete(product.id, upload.uploadId)));
        for (const res of results) assert.ok(res.status === 200 || res.status === 409, `status ${res.status}`);
        const detail = await ok(await complete(product.id, upload.uploadId));
        assert.equal(detail.images.length, 1);
        assert.equal(h.storage.media.size, 1);
        await assertNormalized(h.storage.media.get(storedKey(detail))?.body ?? Buffer.alloc(0), 1024, 768);
      });

      it("media write failure: the retry normalizes again and publishes under a new key", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        h.storage.failPutMedia = true;
        await expectError(await complete(product.id, upload.uploadId), 503, "PRODUCT_IMAGE_STORAGE_UNAVAILABLE");
        h.storage.failPutMedia = false;
        assert.equal(h.storage.media.size, 0);
        assert.ok(h.storage.staging.has(stagingKey(product.id, upload.uploadId)), "the original is kept for the retry");
        const detail = await ok(await complete(product.id, upload.uploadId));
        await assertNormalized(h.storage.media.get(storedKey(detail))?.body ?? Buffer.alloc(0), 1024, 768);
        const rows = await h.prisma.productImage.findMany({ where: { uploadId: upload.uploadId } });
        assert.equal(new Set(rows.map((r) => r.objectKey)).size, 2);
      });

      it("database failure after the write: the object is removed, and the retry is normalized", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        h.faults.productImage.beforeCommit = () => {
          throw new Error("database down");
        };
        await expectError(await complete(product.id, upload.uploadId), 503);
        delete h.faults.productImage.beforeCommit;
        assert.equal(h.storage.media.size, 0);
        const detail = await ok(await complete(product.id, upload.uploadId));
        assert.equal(h.storage.media.size, 1);
        await assertNormalized(h.storage.media.get(storedKey(detail))?.body ?? Buffer.alloc(0), 1024, 768);
      });

      it("a stale attempt removes only its own object; the winner's normalized image stays", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        h.faults.productImage.beforeCommit = async (attempt) => {
          if (attempt !== 1) return;
          await h.prisma.productImageUpload.update({ where: { id: upload.uploadId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
          assert.equal((await complete(product.id, upload.uploadId)).status, 200);
        };
        const detail = await ok(await complete(product.id, upload.uploadId));
        delete h.faults.productImage.beforeCommit;
        assert.equal(h.storage.media.size, 1);
        await assertNormalized(h.storage.media.get(storedKey(detail))?.body ?? Buffer.alloc(0), 1024, 768);
      });

      it("a staging read failure keeps the upload retryable; a later read is normalized", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        h.storage.failReadStaging = true;
        for (let i = 0; i < 4; i += 1) await expectError(await complete(product.id, upload.uploadId), 503);
        h.storage.failReadStaging = false;
        const detail = await ok(await complete(product.id, upload.uploadId));
        assert.equal(detail.images.length, 1);
      });

      it("a refused file leaves nothing public and is terminal", async () => {
        const product = await created();
        const photo = await phonePhoto();
        const upload = await staged(product.id, photo.subarray(0, Math.floor(photo.length / 2)), "image/jpeg");
        await expectError(await complete(product.id, upload.uploadId), 422, "PRODUCT_IMAGE_INVALID");
        await expectError(await complete(product.id, upload.uploadId), 422, "PRODUCT_IMAGE_INVALID");
        assert.equal(h.storage.media.size, 0);
        assert.equal(await h.prisma.productImage.count(), 0);
      });

      it("the cleanup job removes a normalized object whose attempt was abandoned", async () => {
        const product = await created();
        const upload = await staged(product.id, await phonePhoto(), "image/jpeg");
        h.storage.failPutMediaAfterWrite = true;
        await expectError(await complete(product.id, upload.uploadId), 503);
        h.storage.failPutMediaAfterWrite = false;
        assert.equal(h.storage.media.size, 1);
        await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        assert.equal(h.storage.media.size, 0);
      });
    });

    describe("failure recovery (same rules as the logo flow)", () => {
      it("media write failure: nothing is published, and a retry succeeds under a new key", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.storage.failPutMedia = true;
        await expectError(await complete(product.id, upload.uploadId), 503, "PRODUCT_IMAGE_STORAGE_UNAVAILABLE");
        h.storage.failPutMedia = false;
        assert.equal((await ok(await complete(product.id, upload.uploadId))).images.length, 1);
        const rows = await h.prisma.productImage.findMany({ where: { uploadId: upload.uploadId } });
        assert.deepEqual(rows.map((r) => r.status).sort(), ["ACTIVE", "RELEASED"]);
      });

      it("a write that times out after writing leaves an object that reconciliation deletes", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.storage.failPutMediaAfterWrite = true;
        await expectError(await complete(product.id, upload.uploadId), 503);
        h.storage.failPutMediaAfterWrite = false;
        assert.equal(h.storage.media.size, 1);
        await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        assert.equal(h.storage.media.size, 0);
      });

      it("staging read failure → 503, retryable", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.storage.failReadStaging = true;
        await expectError(await complete(product.id, upload.uploadId), 503, "PRODUCT_IMAGE_STORAGE_UNAVAILABLE");
        h.storage.failReadStaging = false;
        assert.equal((await ok(await complete(product.id, upload.uploadId))).images.length, 1);
      });

      it("a database failure after the write: the new object is deleted, and the retry works", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.faults.productImage.beforeCommit = () => {
          throw new Error("database down");
        };
        await expectError(await complete(product.id, upload.uploadId), 503);
        delete h.faults.productImage.beforeCommit;
        assert.equal(h.storage.media.size, 0);
        const detail = await ok(await complete(product.id, upload.uploadId));
        assert.equal(detail.images.length, 1);
        assert.equal(h.storage.media.size, 1);
      });

      it("the compensating delete fails: reconciliation retries it", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.faults.productImage.beforeCommit = () => {
          throw new Error("database down");
        };
        h.storage.failDeleteMedia = true;
        await expectError(await complete(product.id, upload.uploadId), 503);
        delete h.faults.productImage.beforeCommit;
        assert.equal(h.storage.media.size, 1);
        const failed = await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        assert.equal(failed.failedImageDeletes, 1);
        const row = await h.prisma.productImage.findFirst({ where: { uploadId: upload.uploadId } });
        assert.equal(row?.lastDeleteError, "STORAGE_ERROR");
        h.storage.failDeleteMedia = false;
        await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        assert.equal(h.storage.media.size, 0);
      });

      it("a stale attempt cannot commit, and removes only its own object", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.faults.productImage.beforeCommit = async (attempt) => {
          if (attempt !== 1) return;
          // The lease expired; a newer attempt completes first.
          await h.prisma.productImageUpload.update({ where: { id: upload.uploadId }, data: { leaseExpiresAt: new Date(Date.now() - 1000) } });
          assert.equal((await complete(product.id, upload.uploadId)).status, 200);
        };
        const stale = await complete(product.id, upload.uploadId);
        delete h.faults.productImage.beforeCommit;
        assert.equal(stale.status, 200);
        const detail = (await stale.json()) as SellerProductDetail;
        assert.equal(detail.images.length, 1);
        assert.equal(h.storage.media.size, 1);
        assert.equal(detail.images[0]?.url, `${MEDIA_BASE_URL}/${[...h.storage.media.keys()][0]}`);
        const rows = await h.prisma.productImage.findMany({ where: { uploadId: upload.uploadId }, orderBy: { attempt: "asc" } });
        assert.deepEqual(rows.map((r) => r.status), ["DELETED", "ACTIVE"]);
      });

      it("the shop is suspended during completion: 403, nothing published", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.faults.productImage.beforeCommit = async () => {
          await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
        };
        await expectError(await complete(product.id, upload.uploadId), 403);
        delete h.faults.productImage.beforeCommit;
        assert.equal(h.storage.media.size, 0);
        assert.equal(await h.prisma.productImage.count({ where: { status: "ACTIVE" } }), 0);
      });

      it("the product is archived during completion: 409, nothing published", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        h.faults.productImage.beforeCommit = async () => {
          await ok(await post(`${base}/${product.id}/archive`, seller));
        };
        await expectError(await complete(product.id, upload.uploadId), 409, "PRODUCT_ARCHIVED");
        delete h.faults.productImage.beforeCommit;
        assert.equal(h.storage.media.size, 0);
        await expectError(await complete(product.id, upload.uploadId), 409, "PRODUCT_ARCHIVED");
      });

      it("a repeated completion after the image was removed reports expiry, not a dead image", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(30, 30));
        const detail = await ok(await complete(product.id, upload.uploadId));
        await ok(await del(`${base}/${product.id}/images/${detail.images[0]?.id ?? ""}`, seller));
        await expectError(await complete(product.id, upload.uploadId), 410, "PRODUCT_IMAGE_UPLOAD_EXPIRED");
      });
    });

    describe("cleanup job", () => {
      it("expires old uploads, reclaims abandoned leases, and removes staging objects of finished uploads only", async () => {
        const product = await created();
        const done = await staged(product.id, await image(10, 10));
        await ok(await complete(product.id, done.uploadId));
        const live = await staged(product.id, await image(10, 10));
        const old = await staged(product.id, await image(10, 10));
        await h.prisma.productImageUpload.update({ where: { id: old.uploadId }, data: { completeBy: new Date(Date.now() - 1000) } });
        const abandoned = await staged(product.id, await image(10, 10));
        await h.prisma.productImageUpload.update({
          where: { id: abandoned.uploadId },
          data: { status: "PROCESSING", attempt: 1, leaseExpiresAt: new Date(Date.now() - 1000) },
        });
        const abandonedLate = await staged(product.id, await image(10, 10));
        await h.prisma.productImageUpload.update({
          where: { id: abandonedLate.uploadId },
          data: { status: "PROCESSING", attempt: 1, leaseExpiresAt: new Date(Date.now() - 1000), completeBy: new Date(Date.now() - 1000) },
        });
        const leased = await staged(product.id, await image(10, 10));
        await h.prisma.productImageUpload.update({
          where: { id: leased.uploadId },
          data: { status: "PROCESSING", attempt: 1, leaseExpiresAt: new Date(Date.now() + 60_000) },
        });

        const result = await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        assert.equal(result.expiredUploads, 1);
        assert.equal(result.reclaimedToPending, 1);
        assert.equal(result.reclaimedToExpired, 1);

        const status = async (id: string) => (await h.prisma.productImageUpload.findUnique({ where: { id } }))?.status;
        assert.equal(await status(live.uploadId), "PENDING");
        assert.equal(await status(old.uploadId), "EXPIRED");
        assert.equal(await status(abandoned.uploadId), "PENDING");
        assert.equal(await status(abandonedLate.uploadId), "EXPIRED");
        assert.equal(await status(leased.uploadId), "PROCESSING");
        assert.ok(!h.storage.staging.has(stagingKey(product.id, old.uploadId)));
        assert.ok(!h.storage.staging.has(stagingKey(product.id, done.uploadId)));
        assert.ok(h.storage.staging.has(stagingKey(product.id, live.uploadId)));
        assert.ok(h.storage.staging.has(stagingKey(product.id, abandoned.uploadId)));
        assert.ok(h.storage.staging.has(stagingKey(product.id, leased.uploadId)));
        assert.equal(h.storage.media.size, 1, "the active image stays");
      });

      it("never deletes active images and is safe to repeat", async () => {
        const product = await created();
        await withImage(product.id);
        for (let i = 0; i < 2; i += 1) {
          const result = await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
          assert.equal(result.deletedImages, 0);
        }
        assert.equal(h.storage.media.size, 1);
      });

      it("reclaims an orphaned PENDING image after the lease; a late commit of it fails", async () => {
        const product = await created();
        const upload = await staged(product.id, await image(10, 10));
        h.faults.productImage.beforeCommit = async () => {
          await h.prisma.productImage.updateMany({
            where: { uploadId: upload.uploadId },
            data: { createdAt: new Date(Date.now() - TEST_TIMING.completionLeaseMs - 1000) },
          });
          await runProductImageCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING });
        };
        const res = await complete(product.id, upload.uploadId);
        delete h.faults.productImage.beforeCommit;
        assert.equal(res.status, 409);
        assert.equal(await h.prisma.productImage.count({ where: { status: "ACTIVE" } }), 0);
        assert.equal(h.storage.media.size, 0);
        const retried = await ok(await complete(product.id, upload.uploadId));
        assert.equal(retried.images.length, 1);
      });
    });
  });
});
