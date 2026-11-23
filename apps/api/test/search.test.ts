import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { catalogListQuerySchema, normalizeSearchText, type PublicProductListResponse, type SellerProductDetail } from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { Prisma } from "../src/generated/prisma/client.js";
import {
  CATEGORY_SEARCH_TERMS,
  MeilisearchClient,
  MeilisearchProductIndex,
  priceToMinor,
  ProductSearch,
  quoteFilterValue,
  requestSearchReconciliation,
  runSearchIndexing,
  SearchEngineError,
  searchErrorCode,
  searchFilter,
  toSearchDocument,
  withoutArabicArticles,
  type ProductIndexWriter,
  type ProductSearchDocument,
  type ProductSearchEngine,
  type SearchHits,
  type SearchQuery,
} from "../src/modules/search/index.js";
import { CatalogService, searchTextWhere } from "../src/modules/products/index.js";
import { MEDIA_BASE_URL, ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];
const meiliUrl = process.env["TEST_MEILI_URL"];
const meiliKey = process.env["TEST_MEILI_API_KEY"];

const parse = (query: Record<string, string>) => catalogListQuerySchema.safeParse(query);

describe("search query contract (spec 18)", () => {
  it("normalizes the text: spaces, invisible marks, Arabic presentation forms", () => {
    assert.equal(normalizeSearchText("  robe \t\n  en   soie  "), "robe en soie");
    assert.equal(normalizeSearchText("‏ملحفة‎"), "ملحفة");
    // U+FEE3 U+FEE0 U+FEA4 U+FED4 U+FE94: "ملحفة" in presentation forms.
    assert.equal(normalizeSearchText("ﻣﻠﺤﻔﺔ"), "ملحفة");
    assert.equal(normalizeSearchText("a\u0000b"), "a b");
  });

  it("defaults to relevance with a query and to newest without one", () => {
    assert.deepEqual(parse({ q: "  Robe  " }).data, { q: "Robe", sort: "relevance", page: 1, pageSize: 20 });
    assert.deepEqual(parse({}).data, { sort: "newest", page: 1, pageSize: 20 });
    assert.equal(parse({ q: "robe", sort: "price_asc" }).data?.sort, "price_asc");
  });

  it("treats an empty or blank query as no search", () => {
    assert.deepEqual(parse({ q: "   " }).data, { sort: "newest", page: 1, pageSize: 20 });
    assert.equal(parse({ q: "", sort: "relevance" }).success, false);
  });

  it("refuses relevance without a query, a long query, and unknown parameters", () => {
    assert.equal(parse({ sort: "relevance" }).success, false);
    assert.equal(parse({ q: "a".repeat(100) }).success, true);
    assert.equal(parse({ q: "a".repeat(101) }).success, false);
    assert.equal(parse({ q: "robe", filter: "available = false" }).success, false);
    assert.equal(parse({ q: "robe", sort: "rank" }).success, false);
    assert.equal(parse({ q: "robe", page: "0" }).success, false);
    assert.equal(parse({ q: "robe", pageSize: "51" }).success, false);
  });
});

describe("search document and filters (spec 18)", () => {
  const source = {
    id: randomUUID(),
    name: "Melhfa",
    description: "Voile",
    brand: null,
    category: "CLOTHING" as const,
    price: new Prisma.Decimal("1500.50"),
    stock: 7,
    publishedAt: new Date("2026-11-01T10:00:00Z"),
    variants: [
      { size: "M", color: "Noir", stock: 0 },
      { size: "L", color: null, stock: 2 },
    ],
    shop: { shopName: "Boutique" },
  };

  it("holds public fields only, with integer prices and no stock quantities", () => {
    const document = toSearchDocument(source);
    assert.deepEqual(Object.keys(document).sort(), [
      "availableVariantKeys",
      "available",
      "brand",
      "category",
      "categoryTerms",
      "description",
      "descriptionForms",
      "id",
      "name",
      "nameForms",
      "priceMinor",
      "publishedAt",
      "shopName",
      "variantKeys",
    ].sort());
    assert.equal(document.priceMinor, 150050);
    assert.equal(document.publishedAt, Date.parse("2026-11-01T10:00:00Z"));
    assert.equal(document.available, true);
    assert.deepEqual(document.categoryTerms, CATEGORY_SEARCH_TERMS.CLOTHING);
    assert.ok(document.variantKeys.includes(`pair:${JSON.stringify(["m", "noir"])}`));
    assert.ok(!document.availableVariantKeys.includes(`pair:${JSON.stringify(["m", "noir"])}`));
    assert.ok(document.availableVariantKeys.includes("size:l"));
    assert.ok(!JSON.stringify(document).includes('"stock"'));
  });

  it("strips Arabic articles on both sides, keeping short words whole", () => {
    assert.equal(withoutArabicArticles("الملحفة الموريتانية"), "ملحفة موريتانية");
    assert.equal(withoutArabicArticles("وال ملحفة"), "وال ملحفة");
    assert.equal(withoutArabicArticles("للبنات بالقطن"), "بنات قطن");
    assert.equal(withoutArabicArticles("الى Robe"), "الى Robe");
    const document = toSearchDocument({ ...source, name: "الملحفة", description: "قماش", shop: { shopName: "متجر النور" } });
    assert.equal(document.nameForms, "ملحفة متجر نور");
    assert.equal(document.descriptionForms, "");
    assert.equal(toSearchDocument(source).nameForms, "");
  });

  it("converts prices without floating point", () => {
    assert.equal(priceToMinor("0.00"), 0);
    assert.equal(priceToMinor("9999999999.99"), 999999999999);
    assert.equal(priceToMinor("19.9"), 1990);
  });

  it("builds filters from validated fields only, with values quoted", () => {
    const query = catalogListQuerySchema.parse({
      q: "robe",
      category: "SHOES",
      minPrice: "10",
      maxPrice: "20.5",
      size: "M",
      color: 'Noir" OR available = false',
      availability: "available",
    });
    const filter = searchFilter(query);
    assert.deepEqual(filter.slice(0, 3), ['category = "SHOES"', "priceMinor >= 1000", "priceMinor <= 2050"]);
    assert.equal(filter.length, 4);
    assert.match(filter[3] ?? "", /^availableVariantKeys = "pair:/);
    // The quote inside the value is escaped, so it cannot close the string.
    assert.equal(quoteFilterValue('a"b\\c'), '"a\\"b\\\\c"');
    assert.ok(!/[^\\]" OR/.test(filter[3] ?? ""));
    assert.deepEqual(searchFilter(catalogListQuerySchema.parse({ q: "x", availability: "available" })), ["available = true"]);
    assert.deepEqual(searchFilter(catalogListQuerySchema.parse({ q: "x", size: "M" })), ['variantKeys = "size:m"']);
  });

  it("splits the fallback text into at most eight distinct words", () => {
    const where = searchTextWhere("a b a c d e f g h i j");
    assert.equal((where.AND as unknown[]).length, 8);
  });
});

describe("search engine failures (spec 18)", () => {
  const query = catalogListQuerySchema.parse({ q: "robe" }) as SearchQuery;

  it("answers from PostgreSQL without an engine", async () => {
    assert.equal(await new ProductSearch(undefined).find(query), null);
  });

  it("cools down after a failure, logs the code but never the query", async () => {
    let calls = 0;
    let clock = 0;
    const lines: string[] = [];
    const engine: ProductSearchEngine = {
      search: async () => {
        calls += 1;
        throw new SearchEngineError("index_not_found", 404);
      },
    };
    const search = new ProductSearch(engine, { cooldownMs: 1000, now: () => clock, log: (line) => lines.push(line) });
    assert.equal(await search.find({ ...query, q: "secret words" }), null);
    assert.equal(await search.find(query), null);
    assert.equal(calls, 1);
    assert.equal(lines.length, 1);
    assert.match(lines[0] ?? "", /index_not_found/);
    assert.ok(!(lines[0] ?? "").includes("secret"));
    clock = 1001;
    await search.find(query);
    assert.equal(calls, 2);
  });

  it("reduces any failure to a stable code without the response body", async () => {
    const respond = (status: number, body: string) =>
      new MeilisearchClient({ url: "http://meili.test/", apiKey: "key", indexUid: "products", timeoutMs: 100 }, async () => new Response(body, { status }));
    await assert.rejects(respond(404, '{"code":"index_not_found","message":"x"}').search({ q: "a", filter: [], page: 1, hitsPerPage: 1, matchingStrategy: "last" }), (error) => {
      assert.equal(searchErrorCode(error), "index_not_found");
      return true;
    });
    await assert.rejects(respond(500, '{"code":"Bad code with spaces <script>"}').search({ q: "a", filter: [], page: 1, hitsPerPage: 1, matchingStrategy: "last" }), (error) => {
      assert.equal(searchErrorCode(error), "http_500");
      return true;
    });
    const timeout = new MeilisearchClient({ url: "http://meili.test", apiKey: undefined, indexUid: "products", timeoutMs: 10 }, (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    // `AbortSignal.timeout` does not keep the process alive; a real request's socket would.
    const keepAlive = setTimeout(() => undefined, 5000);
    await assert.rejects(timeout.search({ q: "a", filter: [], page: 1, hitsPerPage: 1, matchingStrategy: "last" }), (error) => {
      assert.equal(searchErrorCode(error), "timeout");
      return true;
    });
    clearTimeout(keepAlive);
    assert.equal(searchErrorCode(new TypeError("fetch failed")), "network");
  });

  it("sends the key, retrieves IDs only, and waits for tasks", async () => {
    const requests: { url: string; auth: string | null; body: unknown }[] = [];
    let polls = 0;
    const client = new MeilisearchClient({ url: "http://meili.test", apiKey: "k", indexUid: "products", timeoutMs: 100 }, async (url, init) => {
      requests.push({ url: String(url), auth: new Headers(init?.headers).get("authorization"), body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
      if (String(url).endsWith("/search")) return Response.json({ hits: [{ id: "a" }, { id: 3 }], totalHits: 7 });
      if (String(url).includes("/tasks/")) return Response.json({ status: (polls += 1) > 1 ? "succeeded" : "processing" });
      return Response.json({ taskUid: 9 });
    }, async () => undefined);
    assert.deepEqual(await client.search({ q: "a", filter: [], page: 1, hitsPerPage: 5, matchingStrategy: "last" }), { ids: ["a"], totalHits: 7 });
    assert.deepEqual((requests[0]?.body as { attributesToRetrieve: string[] }).attributesToRetrieve, ["id"]);
    assert.equal(requests[0]?.auth, "Bearer k");
    await client.deleteDocuments(["x"]);
    assert.equal(requests.filter((request) => request.url.endsWith("/tasks/9")).length, 2);
  });
});

/** An in-memory index: documents by ID, word search, failure injection. */
class FakeIndex implements ProductIndexWriter, ProductSearchEngine {
  readonly documents = new Map<string, ProductSearchDocument>();
  /** Extra IDs returned by every search, as a stale index would. */
  extraHits: string[] = [];
  failWrites: string | null = null;
  onReplace: (() => Promise<void>) | null = null;
  prepared = 0;

  async prepare(): Promise<void> {
    if (this.failWrites !== null) throw new SearchEngineError(this.failWrites);
    this.prepared += 1;
  }

  async replace(documents: readonly ProductSearchDocument[]): Promise<void> {
    if (this.failWrites !== null) throw new SearchEngineError(this.failWrites);
    await this.onReplace?.();
    for (const document of documents) this.documents.set(document.id, document);
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (this.failWrites !== null) throw new SearchEngineError(this.failWrites);
    for (const id of ids) this.documents.delete(id);
  }

  async ids(offset: number, limit: number) {
    const all = [...this.documents.keys()];
    return { ids: all.slice(offset, offset + limit), total: all.length };
  }

  async search(query: SearchQuery): Promise<SearchHits> {
    const words = query.q.toLowerCase().split(" ");
    const ids = [...this.documents.values()]
      .filter((doc) => words.every((word) => [doc.name, doc.shopName, doc.brand ?? "", doc.description].some((field) => field.toLowerCase().includes(word))))
      .map((doc) => doc.id);
    const all = [...ids, ...this.extraHits];
    return { ids: all.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: all.length };
  }
}

describe("search indexing and results (spec 18, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let tiny: Buffer;
  let index: FakeIndex;

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
    index = new FakeIndex();
  });

  const base = "/sellers/me/products";
  const post = (path: string, body?: unknown) => h.call(path, seller.token, { method: "POST", body });
  const drain = () => runSearchIndexing({ prisma: h.prisma, index });
  const queued = async () => (await h.prisma.searchIndexTask.findMany({ select: { productId: true } })).map((task) => task.productId);

  async function product(spec: { name?: string; description?: string; price?: string; publish?: boolean } = {}): Promise<SellerProductDetail> {
    const res = await post(base, {
      name: spec.name ?? "Melhfa",
      description: spec.description ?? "Voile léger.",
      category: "CLOTHING",
      price: spec.price ?? "1500.00",
      stock: 3,
    });
    assert.equal(res.status, 201);
    const created = (await res.json()) as SellerProductDetail;
    const upload = await post(`${base}/${created.id}/images/uploads`, { contentType: "image/png", contentLength: tiny.byteLength });
    const { uploadId } = (await upload.json()) as { uploadId: string };
    h.storage.staging.set(`product-images/${shopId}/${created.id}/${uploadId}`, tiny);
    assert.equal((await post(`${base}/${created.id}/images/uploads/${uploadId}/complete`)).status, 200);
    if (spec.publish !== false) assert.equal((await post(`${base}/${created.id}/publish`)).status, 200);
    return created;
  }

  async function search(query: string): Promise<PublicProductListResponse> {
    const res = await h.call(`/products?${query}`, null);
    assert.equal(res.status, 200, `GET /products?${query}`);
    return (await res.json()) as PublicProductListResponse;
  }

  describe("synchronization", () => {
    it("queues a product on every change and indexes only public ones", async () => {
      const draft = await product({ name: "Brouillon", publish: false });
      const live = await product({ name: "Publié" });
      assert.deepEqual((await queued()).sort(), [draft.id, live.id].sort());

      const run = await drain();
      assert.deepEqual(run, { indexed: 1, removed: 1, failed: 0, errorCode: null });
      assert.deepEqual([...index.documents.keys()], [live.id]);
      assert.deepEqual(await queued(), []);
    });

    it("follows edits, stock, archival, restoration, and removal", async () => {
      const item = await product({ name: "Robe" });
      await drain();

      assert.equal((await h.call(`${base}/${item.id}`, seller.token, { method: "PATCH", body: { name: "Robe longue", price: "2000.00" } })).status, 200);
      await drain();
      assert.equal(index.documents.get(item.id)?.name, "Robe longue");
      assert.equal(index.documents.get(item.id)?.priceMinor, 200000);

      // Sold out stays indexed (C8), marked unavailable.
      await h.prisma.product.update({ where: { id: item.id }, data: { stock: 0 } });
      await drain();
      assert.equal(index.documents.get(item.id)?.available, false);

      assert.equal((await post(`${base}/${item.id}/archive`)).status, 200);
      await drain();
      assert.equal(index.documents.has(item.id), false);

      assert.equal((await post(`${base}/${item.id}/restore`)).status, 200);
      await drain();
      assert.equal(index.documents.has(item.id), false, "restored products are drafts");

      assert.equal((await post(`${base}/${item.id}/publish`)).status, 200);
      await drain();
      assert.equal(index.documents.has(item.id), true);

      // Losing its last active image makes a product non-public.
      await h.prisma.productImage.updateMany({ where: { productId: item.id }, data: { status: "RELEASED" } });
      await drain();
      assert.equal(index.documents.has(item.id), false, "no active image: not public");
    });

    it("follows variants and the shop: suspension hides, reinstatement and renaming update", async () => {
      const item = await product();
      await drain();
      await h.prisma.productVariant.create({ data: { productId: item.id, size: "M", color: "Noir", stock: 0 } });
      await drain();
      assert.deepEqual(index.documents.get(item.id)?.availableVariantKeys, []);

      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.deepEqual(await queued(), [item.id]);
      await drain();
      assert.equal(index.documents.has(item.id), false);

      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "APPROVED", shopName: "Nouvelle Boutique" } });
      await drain();
      assert.equal(index.documents.get(item.id)?.shopName, "Nouvelle Boutique");

      // A shop change that touches neither status nor name queues nothing.
      await h.prisma.shop.update({ where: { id: shopId }, data: { city: "Nouadhibou" } });
      assert.deepEqual(await queued(), []);
    });
  });

  describe("product moderation (spec 19)", () => {
    const restrictBody = {
      expectedStatus: "CLEAR",
      sellerReasonCode: "COUNTERFEIT",
      sellerMessage: "Ce produit semble être une contrefaçon.",
      internalReason: "Vérifié par l'équipe de modération.",
    };

    it("queues every transition: a restriction removes the document, a restoration re-adds it", async () => {
      const admin = await h.actor("ADMIN");
      const item = await product({ name: "Robe modérée" });
      await drain();
      assert.equal(index.documents.has(item.id), true);

      assert.equal((await h.call(`/admin/products/${item.id}/moderation/restrict`, admin.token, { method: "POST", body: restrictBody })).status, 200);
      assert.deepEqual(await queued(), [item.id], "the trigger watches moderationStatus");
      await drain();
      assert.equal(index.documents.has(item.id), false);

      const restore = { expectedStatus: "RESTRICTED", internalReason: "Restauration après vérification." };
      assert.equal((await h.call(`/admin/products/${item.id}/moderation/restore`, admin.token, { method: "POST", body: restore })).status, 200);
      assert.deepEqual(await queued(), [item.id]);
      await drain();
      assert.equal(index.documents.has(item.id), true);
      // No moderation data in search documents.
      assert.equal(/moderation|RESTRICTED|CLEAR/i.test(JSON.stringify(index.documents.get(item.id))), false);
    });

    it("excludes a moderated product a stale engine still returns", async () => {
      const admin = await h.actor("ADMIN");
      const visible = await product({ name: "Robe visible" });
      const moderated = await product({ name: "Robe restreinte" });
      await drain();
      h.searchEngine = index;
      assert.equal((await h.call(`/admin/products/${moderated.id}/moderation/restrict`, admin.token, { method: "POST", body: restrictBody })).status, 200);
      // The index has not caught up: the engine still returns the moderated product.
      assert.equal(index.documents.has(moderated.id), true);
      const body = await search("q=robe");
      assert.deepEqual(body.products.map((p) => p.id), [visible.id]);
      assert.ok(!JSON.stringify(body).includes(moderated.id));
    });
  });

  describe("failures and recovery", () => {
    it("keeps failed tasks with a growing delay and an error code, then retries them", async () => {
      const item = await product();
      index.failWrites = "timeout";
      const run = await drain();
      assert.deepEqual(run, { indexed: 0, removed: 0, failed: 1, errorCode: "timeout" });
      let task = await h.prisma.searchIndexTask.findUniqueOrThrow({ where: { productId: item.id } });
      assert.equal(task.attempts, 1);
      assert.equal(task.lastErrorCode, "timeout");
      const delay = task.nextAttemptAt.getTime() - Date.now();
      assert.ok(delay > 5_000 && delay <= 10_500, `first retry after about 10 s, got ${delay}`);

      // Not due yet: nothing is attempted.
      index.failWrites = null;
      assert.deepEqual(await drain(), { indexed: 0, removed: 0, failed: 0, errorCode: null });

      index.failWrites = "timeout";
      await h.prisma.searchIndexTask.update({ where: { productId: item.id }, data: { nextAttemptAt: new Date() } });
      await drain();
      task = await h.prisma.searchIndexTask.findUniqueOrThrow({ where: { productId: item.id } });
      assert.equal(task.attempts, 2);
      assert.ok(task.nextAttemptAt.getTime() - Date.now() > 15_000, "the second retry waits twice as long");

      index.failWrites = null;
      await h.prisma.searchIndexTask.update({ where: { productId: item.id }, data: { nextAttemptAt: new Date() } });
      assert.equal((await drain()).indexed, 1);
      assert.deepEqual(await queued(), []);
    });

    it("keeps a task changed while its batch was being indexed", async () => {
      const item = await product();
      index.onReplace = async () => {
        index.onReplace = null;
        await h.prisma.product.update({ where: { id: item.id }, data: { name: "Changé pendant l'indexation" } });
      };
      const run = await drain();
      assert.equal(index.documents.get(item.id)?.name, "Changé pendant l'indexation");
      // The first batch indexed the old name and left the newer task queued; the next batch indexed the new name.
      assert.equal(run.indexed, 2);
      assert.deepEqual(await queued(), []);
    });

    it("reconciliation restores missing documents and removes stale ones", async () => {
      const live = await product({ name: "Visible" });
      const hidden = await product({ name: "Caché" });
      await drain();
      // The index lost a document and kept one it should not have.
      index.documents.delete(live.id);
      await h.prisma.product.update({ where: { id: hidden.id }, data: { status: "ARCHIVED", archivedAt: new Date() } });
      await h.prisma.searchIndexTask.deleteMany();
      index.documents.set("not-a-product", { ...(index.documents.get(hidden.id) as ProductSearchDocument), id: "not-a-product" });

      const result = await requestSearchReconciliation({ prisma: h.prisma, index });
      assert.deepEqual(result, { queuedPublic: 1, queuedStale: 1, removedForeign: 1 });
      await drain();
      assert.deepEqual([...index.documents.keys()], [live.id]);
    });
  });

  describe("GET /products?q=", () => {
    it("returns engine matches in engine order, re-checked against PostgreSQL", async () => {
      const first = await product({ name: "Robe rouge" });
      const second = await product({ name: "Robe bleue", price: "900.00" });
      const hidden = await product({ name: "Robe cachée", publish: false });
      await drain();
      h.searchEngine = index;
      // A stale index returning a hidden product, and an unknown ID.
      index.extraHits = [hidden.id, randomUUID()];

      const body = await search("q=robe");
      assert.deepEqual(new Set(body.products.map((item) => item.id)), new Set([first.id, second.id]));
      assert.deepEqual(body.search, { degraded: false });
      // Only visible products are counted (QA-06).
      assert.equal(body.total, 2);
      assert.ok(!JSON.stringify(body).includes(hidden.id));

      // Pages are cut after the check: full pages, and the last one is where the total says.
      const page1 = await search("q=robe&pageSize=1&page=1");
      const page2 = await search("q=robe&pageSize=1&page=2");
      const page3 = await search("q=robe&pageSize=1&page=3");
      assert.equal(page1.products.length, 1);
      assert.equal(page2.products.length, 1);
      assert.equal(page3.products.length, 0);
      assert.deepEqual(new Set([page1.products[0]?.id, page2.products[0]?.id]), new Set([first.id, second.id]));
      assert.equal(page2.total, 2);

      // Filters are applied again in PostgreSQL even when the engine ignores them.
      const filtered = await search("q=robe&maxPrice=1000");
      assert.deepEqual(filtered.products.map((item) => item.id), [second.id]);
      // Cards come from PostgreSQL: the current price, not the indexed one.
      await h.prisma.product.update({ where: { id: second.id }, data: { price: "950.00" } });
      assert.equal((await search("q=bleue")).products[0]?.price, "950.00");
    });

    it("falls back to PostgreSQL when the engine fails, and says so", async () => {
      await product({ name: "Robe en soie", description: "Coupe ample" });
      await product({ name: "Sandales", description: "Cuir" });
      await product({ name: "100% coton", description: "Tissu" });
      h.searchEngine = { search: async () => Promise.reject(new SearchEngineError("timeout")) };

      const body = await search(`q=${encodeURIComponent("ROBE ample")}`);
      assert.deepEqual(body.products.map((item) => item.name), ["Robe en soie"]);
      assert.deepEqual(body.search, { degraded: true });
      assert.match(h.searchLog.join("\n"), /timeout/);

      // The shop name is searched; `%` and `_` only match themselves.
      assert.equal((await search("q=boutique")).total, 3);
      assert.deepEqual((await search(`q=${encodeURIComponent("100%")}`)).products.map((item) => item.name), ["100% coton"]);
      assert.equal((await search(`q=${encodeURIComponent("1_0")}`)).total, 0);
      assert.equal((await search("q=_")).total, 0);
      // Visibility still applies.
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal((await search("q=robe")).total, 0);
    });

    it("SEARCH_ENGINE=postgres (no engine at all): PostgreSQL answers and the result is not degraded (QA-01)", async () => {
      await product({ name: "Robe en soie", description: "Coupe ample" });
      await product({ name: "Sandales", description: "Cuir" });
      const catalog = new CatalogService(h.prisma, MEDIA_BASE_URL);
      const query = catalogListQuerySchema.parse({ q: "ROBE ample" });
      const body = await catalog.list(query);
      assert.deepEqual(body.products.map((item) => item.name), ["Robe en soie"]);
      assert.deepEqual(body.search, { degraded: false });
      // Visibility still applies.
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal((await catalog.list(query)).total, 0);
    });

    it("keeps the listing response unchanged without a query", async () => {
      await product();
      const body = await search("sort=newest");
      assert.equal(body.search, undefined);
      assert.equal(body.total, 1);
    });

    it("validates the query: 400 with a code-only body", async () => {
      for (const query of ["sort=relevance", `q=${"a".repeat(101)}`, "q=robe&filter=x", "q=robe&sort=rank", "q=robe&page=0"]) {
        const res = await h.call(`/products?${query}`, null);
        assert.equal(res.status, 400, query);
        assert.deepEqual(Object.keys(((await res.json()) as { error: object }).error), ["code"]);
      }
    });
  });
});

/** Real Meilisearch: French and Arabic matching, filters, and sorts with the index settings. */
describe("Meilisearch product index (spec 18)", { skip: meiliUrl === undefined ? "TEST_MEILI_URL is not set" : false }, () => {
  const uid = `test-products-${randomUUID()}`;
  const client = new MeilisearchClient({ url: meiliUrl ?? "", apiKey: meiliKey, indexUid: uid, timeoutMs: 10_000 });
  const index = new MeilisearchProductIndex(client);
  /** Built like `toSearchDocument`, including the article-free forms. */
  const doc = (id: string, fields: Partial<ProductSearchDocument>): ProductSearchDocument => {
    const merged: ProductSearchDocument = {
      id,
      name: "",
      description: "",
      brand: null,
      category: "CLOTHING",
      categoryTerms: CATEGORY_SEARCH_TERMS.CLOTHING,
      shopName: "Boutique",
      nameForms: "",
      descriptionForms: "",
      priceMinor: 100000,
      publishedAt: 1,
      available: true,
      variantKeys: [],
      availableVariantKeys: [],
      ...fields,
    };
    const forms = (text: string) => (withoutArabicArticles(text) === text ? "" : withoutArabicArticles(text));
    return {
      ...merged,
      nameForms: forms([merged.name, merged.brand, merged.shopName].filter((part) => part !== null && part !== "").join(" ")),
      descriptionForms: forms(merged.description),
    };
  };
  const ids = {
    robe: randomUUID(),
    sandales: randomUUID(),
    melhfa: randomUUID(),
    shoes: randomUUID(),
    voile: randomUUID(),
    abaya: randomUUID(),
  };
  const find = async (query: Record<string, string>) => (await index.search(catalogListQuerySchema.parse(query) as SearchQuery)).ids;

  before(async () => {
    await index.prepare();
    await index.replace([
      doc(ids.robe, { name: "Robe en soie", priceMinor: 250000, publishedAt: 3, variantKeys: ["size:m", "color:noir", `pair:${JSON.stringify(["m", "noir"])}`] }),
      doc(ids.sandales, { name: "Sandales en cuir", category: "SHOES", categoryTerms: CATEGORY_SEARCH_TERMS.SHOES, priceMinor: 90000, publishedAt: 2, available: false }),
      doc(ids.melhfa, { name: "الملحفة الموريتانية", description: "قماش خفيف", priceMinor: 150000, publishedAt: 1 }),
      doc(ids.shoes, { name: "حذاء جلد", category: "SHOES", categoryTerms: CATEGORY_SEARCH_TERMS.SHOES, priceMinor: 120000, publishedAt: 4 }),
      doc(ids.voile, { name: "Voile léger", shopName: "Maison Nouakchott", priceMinor: 50000, publishedAt: 5 }),
      doc(ids.abaya, { name: "عباية سوداء", priceMinor: 300000, publishedAt: 6 }),
    ]);
  });
  after(async () => {
    await fetch(`${meiliUrl}/indexes/${uid}`, { method: "DELETE", headers: meiliKey === undefined ? {} : { authorization: `Bearer ${meiliKey}` } });
  });

  it("matches French ignoring case, accents, and small typos", async () => {
    assert.deepEqual(await find({ q: "ROBE" }), [ids.robe]);
    assert.deepEqual(await find({ q: "leger" }), [ids.voile]);
    assert.deepEqual(await find({ q: "sandale" }), [ids.sandales]);
    assert.deepEqual(await find({ q: "sandalles" }), [ids.sandales]);
    assert.deepEqual(await find({ q: "nouakchott" }), [ids.voile], "the shop name is searched");
  });

  it("matches Arabic, including the article, alef forms, and diacritics", async () => {
    assert.deepEqual(await find({ q: "ملحفة" }), [ids.melhfa]);
    assert.deepEqual(await find({ q: "الملحفة" }), [ids.melhfa]);
    assert.deepEqual(await find({ q: "المُلحفة" }), [ids.melhfa]);
    // The name match ranks first; the sandals match through the category word.
    assert.deepEqual(await find({ q: "حذاء" }), [ids.shoes, ids.sandales]);
    assert.deepEqual(await find({ q: "الموريتانيه" }), [ids.melhfa], "teh marbuta written as heh");
    // The article on the query only, and an attached preposition.
    assert.deepEqual(await find({ q: "العباية" }), [ids.abaya]);
    assert.deepEqual(await find({ q: "بالعباية" }), [ids.abaya]);
  });

  it("finds products by category words in both languages", async () => {
    assert.deepEqual(new Set(await find({ q: "chaussures" })), new Set([ids.sandales, ids.shoes]));
    assert.deepEqual(new Set(await find({ q: "أحذية" })), new Set([ids.sandales, ids.shoes]));
    assert.deepEqual(new Set(await find({ q: "احذية" })), new Set([ids.sandales, ids.shoes]));
  });

  it("applies filters and sorts", async () => {
    assert.deepEqual(await find({ q: "chaussures", sort: "price_asc" }), [ids.sandales, ids.shoes]);
    assert.deepEqual(await find({ q: "chaussures", sort: "price_desc" }), [ids.shoes, ids.sandales]);
    assert.deepEqual(await find({ q: "chaussures", sort: "newest" }), [ids.shoes, ids.sandales]);
    assert.deepEqual(await find({ q: "chaussures", availability: "available" }), [ids.shoes]);
    assert.deepEqual(await find({ q: "chaussures", maxPrice: "1000" }), [ids.sandales]);
    assert.deepEqual(await find({ q: "robe", size: "m", color: "NOIR" }), [ids.robe]);
    assert.deepEqual(await find({ q: "robe", size: "L" }), []);
    // A quote in a value is data, not filter syntax.
    assert.deepEqual(await find({ q: "robe", color: 'noir" OR category = "SHOES' }), []);
  });

  it("paginates with an exact total", async () => {
    const page = await index.search(catalogListQuerySchema.parse({ q: "chaussures", pageSize: "1", page: "2", sort: "price_asc" }) as SearchQuery);
    assert.deepEqual(page, { ids: [ids.shoes], total: 2 });
  });

  it("lists and removes documents", async () => {
    const listed = await index.ids(0, 100);
    assert.equal(listed.total, 6);
    await index.remove([ids.voile]);
    assert.deepEqual(await find({ q: "voile" }), []);
  });
});

/** The whole path with nothing faked: triggers, the indexing job, Meilisearch, and the public route. */
describe(
  "search end to end (spec 18, PostgreSQL and Meilisearch)",
  { skip: databaseUrl === undefined || meiliUrl === undefined ? "TEST_DATABASE_URL and TEST_MEILI_URL are needed" : false },
  () => {
    const h = new ShopHarness(databaseUrl ?? "");
    const uid = `test-e2e-${randomUUID()}`;
    const index = new MeilisearchProductIndex(new MeilisearchClient({ url: meiliUrl ?? "", apiKey: meiliKey, indexUid: uid, timeoutMs: 10_000 }));
    let seller: Actor;
    let shopId: string;
    let tiny: Buffer;

    before(async () => {
      await h.start();
      await h.reset();
      ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
      tiny = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: 1, g: 2, b: 3 } } }).png().toBuffer();
      h.searchEngine = index;
    });
    after(async () => {
      await fetch(`${meiliUrl}/indexes/${uid}`, { method: "DELETE", headers: meiliKey === undefined ? {} : { authorization: `Bearer ${meiliKey}` } });
      await h.stop();
    });

    const post = (path: string, body?: unknown) => h.call(path, seller.token, { method: "POST", body });
    async function publish(name: string, price: string): Promise<string> {
      const res = await post("/sellers/me/products", { name, description: "Article de test", category: "CLOTHING", price, stock: 2 });
      const { id } = (await res.json()) as SellerProductDetail;
      const upload = await post(`/sellers/me/products/${id}/images/uploads`, { contentType: "image/png", contentLength: tiny.byteLength });
      const { uploadId } = (await upload.json()) as { uploadId: string };
      h.storage.staging.set(`product-images/${shopId}/${id}/${uploadId}`, tiny);
      assert.equal((await post(`/sellers/me/products/${id}/images/uploads/${uploadId}/complete`)).status, 200);
      assert.equal((await post(`/sellers/me/products/${id}/publish`)).status, 200);
      return id;
    }
    const search = async (q: string, extra = "") => {
      const res = await h.call(`/products?q=${encodeURIComponent(q)}${extra}`, null);
      assert.equal(res.status, 200);
      return (await res.json()) as PublicProductListResponse;
    };

    it("finds French and Arabic products, follows changes, and hides archived ones", async () => {
      const robe = await publish("Robe brodée", "2500.00");
      const melhfa = await publish("ملحفة شنقيطية", "1800.00");
      await runSearchIndexing({ prisma: h.prisma, index });

      const first = await search("robe brodee");
      assert.deepEqual(first.search, { degraded: false }, h.searchLog.join("\n"));
      assert.deepEqual(first.products.map((item) => item.id), [robe]);
      assert.deepEqual((await search("الملحفة")).products.map((item) => item.id), [melhfa]);
      const both = await search("vêtements", "&sort=price_asc");
      assert.deepEqual(both.products.map((item) => item.id), [melhfa, robe]);
      assert.deepEqual(both.search, { degraded: false });

      assert.equal((await post(`/sellers/me/products/${robe}/archive`)).status, 200);
      // Hidden at once by the PostgreSQL check, before the index catches up.
      assert.equal((await search("robe")).products.length, 0);
      await runSearchIndexing({ prisma: h.prisma, index });
      assert.equal((await search("robe")).total, 0);
      assert.deepEqual(await h.prisma.searchIndexTask.findMany(), []);
    });

    it("removes a restricted product's document and re-adds it when restored (spec 19)", async () => {
      const admin = await h.actor("ADMIN");
      const id = await publish("Tunique modérée", "1200.00");
      await runSearchIndexing({ prisma: h.prisma, index });
      assert.deepEqual((await search("tunique")).products.map((item) => item.id), [id]);
      const restrict = {
        expectedStatus: "CLEAR",
        sellerReasonCode: "MISLEADING_INFORMATION",
        sellerMessage: "La description ne correspond pas aux photos.",
        internalReason: "Vérifié par l'équipe de modération.",
      };
      assert.equal((await h.call(`/admin/products/${id}/moderation/restrict`, admin.token, { method: "POST", body: restrict })).status, 200);
      await runSearchIndexing({ prisma: h.prisma, index });
      assert.equal((await index.search({ ...catalogListQuerySchema.parse({ q: "tunique" }), q: "tunique" })).total, 0, "document removed");
      assert.equal((await search("tunique")).total, 0);
      const restore = { expectedStatus: "RESTRICTED", internalReason: "Restauration après vérification." };
      assert.equal((await h.call(`/admin/products/${id}/moderation/restore`, admin.token, { method: "POST", body: restore })).status, 200);
      await runSearchIndexing({ prisma: h.prisma, index });
      assert.deepEqual((await search("tunique")).products.map((item) => item.id), [id]);
    });
  },
);
