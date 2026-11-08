import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { PRODUCT_CATEGORIES, PRODUCT_STATUSES, type ProductVariantView, type SellerProductDetail } from "@chicman/shared"

import { formatMru } from "../../lib/money"
import { uploadProductImage } from "./image-upload"
import { PRODUCT_MESSAGES } from "./messages"
import {
  buildProductCreate,
  buildProductUpdate,
  buildVariantCreate,
  buildVariantUpdate,
  emptyProductForm,
  interpretProductResult,
  mergeProductFormValues,
  moveImage,
  normalizePriceInput,
  parseStockInput,
  productActions,
  productFormValues,
} from "./product-form"

const PRODUCT: SellerProductDetail = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Melhfa",
  description: "Voile léger.",
  category: "CLOTHING",
  brand: "Sahel",
  price: "1500.50",
  status: "DRAFT",
  stock: 3,
  available: true,
  variantCount: 0,
  mainImageUrl: null,
  images: [],
  variants: [],
  publishedAt: null,
  archivedAt: null,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
}
const VALID = { name: "Melhfa", description: "Voile léger.", category: "SHOES", brand: "", price: "1 500,5" }
const VARIANT: ProductVariantView = { id: "v", size: "M", color: null, stock: 1, available: true, createdAt: "", updatedAt: "" }

describe("prices", () => {
  it("formats decimal strings in MRU without floating point", () => {
    assert.equal(formatMru("1500.50", "fr"), "1 500,50 MRU")
    assert.equal(formatMru("9999999999.99", "fr"), "9 999 999 999,99 MRU")
    assert.equal(formatMru("0.30", "fr"), "0,30 MRU")
    assert.equal(formatMru("1500.50", "ar"), "1,500.50 أوقية")
  })

  it("accepts what sellers type", () => {
    assert.equal(normalizePriceInput("1 500,50"), "1500.50")
    assert.equal(normalizePriceInput("1 500 "), "1500")
  })
})

describe("product form", () => {
  it("builds an allowlisted, normalized creation body", () => {
    const built = buildProductCreate(VALID, "4")
    assert.deepEqual(built, { ok: true, body: { name: "Melhfa", description: "Voile léger.", category: "SHOES", brand: null, price: "1500.50", stock: 4 } })
  })

  it("reports each invalid field", () => {
    const built = buildProductCreate(emptyProductForm(), "-1")
    assert.equal(built.ok, false)
    if (built.ok) return
    assert.deepEqual(built.errors, { name: "required", description: "required", category: "required", price: "invalidPrice", stock: "invalid" })
    for (const price of ["0", "abc", "1.999"]) {
      const result = buildProductCreate({ ...VALID, price }, "0")
      assert.equal(!result.ok && result.errors.price, "invalidPrice", price)
    }
    const long = buildProductCreate({ ...VALID, name: "x".repeat(151) }, "0")
    assert.equal(!long.ok && long.errors.name, "tooLong")
  })

  it("an unsupported category cannot be submitted", () => {
    const built = buildProductCreate({ ...VALID, category: "ELECTRONICS" }, "0")
    assert.equal(!built.ok && built.errors.category, "required")
  })

  it("updates send only changed fields; an untouched form sends nothing", () => {
    assert.deepEqual(buildProductUpdate(productFormValues(PRODUCT), PRODUCT), { ok: true, body: {} })
    const values = { ...productFormValues(PRODUCT), price: "2000", brand: "  " }
    assert.deepEqual(buildProductUpdate(values, PRODUCT), { ok: true, body: { brand: null, price: "2000.00" } })
  })

  it("a refreshed product keeps unsaved edits", () => {
    const baseline = productFormValues(PRODUCT)
    const merged = mergeProductFormValues({ ...baseline, name: "Non enregistré" }, baseline, { ...baseline, name: "Serveur", price: "9.00" })
    assert.equal(merged.name, "Non enregistré")
    assert.equal(merged.price, "9.00")
  })
})

describe("stock and variants", () => {
  it("parses whole numbers within the limit only", () => {
    assert.equal(parseStockInput(" 12 "), 12)
    assert.equal(parseStockInput("0"), 0)
    assert.equal(parseStockInput("1000000"), 1_000_000)
    for (const bad of ["-1", "1.5", "1e3", "", "abc", "1000001"]) assert.equal(parseStockInput(bad), null, bad)
  })

  it("a variant needs a size or a color, not necessarily both", () => {
    assert.deepEqual(buildVariantCreate({ size: "M", color: "" }, "2"), { ok: true, body: { size: "M", color: null, stock: 2 } })
    assert.deepEqual(buildVariantCreate({ size: "", color: "Bleu" }, ""), { ok: true, body: { size: null, color: "Bleu", stock: 0 } })
    assert.deepEqual(buildVariantCreate({ size: " ", color: "" }, "1"), { ok: false, errors: "attributeRequired" })
    assert.deepEqual(buildVariantCreate({ size: "M", color: "" }, "-1"), { ok: false, errors: "invalidStock" })
    assert.deepEqual(buildVariantCreate({ size: "x".repeat(31), color: "" }, "1"), { ok: false, errors: "tooLong" })
  })

  it("variant updates send only changes", () => {
    assert.deepEqual(buildVariantUpdate({ size: "M", color: "" }, VARIANT), { ok: true, body: {} })
    assert.deepEqual(buildVariantUpdate({ size: "", color: "Vert" }, VARIANT), { ok: true, body: { size: null, color: "Vert" } })
    assert.deepEqual(buildVariantUpdate({ size: "", color: "" }, VARIANT), { ok: false, errors: "attributeRequired" })
  })
})

describe("product actions", () => {
  const IMAGE = { id: "i", url: "https://media.test/i.png", position: 0, contentType: "image/png", sizeBytes: 1, width: 1, height: 1 } as const
  const withImage = { ...PRODUCT, images: [IMAGE] }

  it("a draft without an image cannot be published and says why", () => {
    const actions = productActions(PRODUCT)
    assert.equal(actions.canPublish, false)
    assert.equal(actions.needsImageToPublish, true)
    assert.equal(productActions(withImage).canPublish, true)
    assert.equal(productActions(withImage).needsImageToPublish, false)
  })

  it("zero stock does not block publication, and the page says so", () => {
    const actions = productActions({ ...withImage, available: false })
    assert.equal(actions.canPublish, true)
    assert.equal(actions.showZeroStockPublishNote, true)
    assert.equal(productActions(withImage).showZeroStockPublishNote, false)
  })

  it("a published product at zero stock explains its unavailable state", () => {
    assert.equal(productActions({ ...withImage, status: "PUBLISHED", available: false }).showOutOfStockNote, true)
    assert.equal(productActions({ ...withImage, status: "PUBLISHED", available: true }).showOutOfStockNote, false)
    assert.equal(productActions({ ...withImage, status: "ARCHIVED", available: false }).showOutOfStockNote, false)
  })

  it("only an archived product can be restored; it cannot be edited, published, or archived until then", () => {
    const archived = productActions({ ...withImage, status: "ARCHIVED", publishedAt: "2026-11-08T10:00:00.000Z" })
    assert.deepEqual(
      [archived.canRestore, archived.editable, archived.canPublish, archived.canArchive, archived.showPublishedAt],
      [true, false, false, false, true]
    )
    for (const status of ["DRAFT", "PUBLISHED"] as const) {
      const actions = productActions({ ...withImage, status })
      assert.deepEqual([actions.canRestore, actions.editable, actions.canArchive], [false, true, true])
    }
  })

  it("a restored draft is not shown as published, even with an earlier publication", () => {
    assert.equal(productActions({ ...withImage, status: "DRAFT", publishedAt: "2026-11-08T10:00:00.000Z" }).showPublishedAt, false)
  })
})

describe("image order", () => {
  it("moves within bounds", () => {
    assert.deepEqual(moveImage(["a", "b", "c"], "b", -1), ["b", "a", "c"])
    assert.deepEqual(moveImage(["a", "b", "c"], "b", 1), ["a", "c", "b"])
    assert.equal(moveImage(["a", "b"], "a", -1), null)
    assert.equal(moveImage(["a", "b"], "b", 1), null)
    assert.equal(moveImage(["a"], "z", 1), null)
  })
})

describe("API outcomes", () => {
  const error = (status: number, code: string | null = null) => interpretProductResult({ kind: "error", status, code })

  it("maps each response to a stable outcome", () => {
    assert.deepEqual(interpretProductResult({ kind: "ok", status: 200, data: 1 }), { state: "ok", data: 1 })
    assert.equal(interpretProductResult({ kind: "unauthorized" }).state, "signed-out")
    assert.equal(interpretProductResult({ kind: "forbidden", code: null }).state, "forbidden")
    assert.equal(interpretProductResult({ kind: "auth-unavailable" }).state, "unavailable")
    assert.equal(interpretProductResult({ kind: "network-error" }).state, "unavailable")
    assert.equal(error(404, "PRODUCT_NOT_FOUND").state, "not-found")
    assert.equal(error(400, "BAD_REQUEST").state, "invalid")
    assert.equal(error(400, "PRODUCT_VARIANT_ATTRIBUTE_REQUIRED").state, "variant-attribute-required")
    assert.equal(error(409, "PRODUCT_ARCHIVED").state, "archived")
    assert.equal(error(409, "PRODUCT_STATUS_CONFLICT").state, "status-conflict")
    assert.equal(error(409, "PRODUCT_PUBLISH_REQUIRES_IMAGE").state, "publish-requires-image")
    assert.equal(error(409, "PRODUCT_LAST_IMAGE_REQUIRED").state, "last-image")
    assert.equal(error(409, "PRODUCT_STOCK_CONFLICT").state, "stock-conflict")
    assert.equal(error(409, "PRODUCT_STOCK_MANAGED_BY_VARIANTS").state, "stock-managed-by-variants")
    assert.equal(error(409, "PRODUCT_VARIANT_ALREADY_EXISTS").state, "variant-exists")
    assert.equal(error(409, "PRODUCT_VARIANT_LIMIT_REACHED").state, "variant-limit")
    assert.equal(error(409, "PRODUCT_IMAGE_LIMIT_REACHED").state, "image-limit")
    assert.equal(error(409, "SOMETHING_ELSE").state, "error")
    assert.equal(error(429).state, "rate-limited")
    assert.equal(error(503).state, "unavailable")
    assert.equal(error(500).state, "error")
  })
})

describe("image upload", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  const png = () => new File([new Uint8Array(10)], "photo.png", { type: "image/png" })
  const UPLOAD = {
    uploadId: "u1",
    uploadUrl: "https://storage.test/staging/u1?X-Amz-Signature=x",
    method: "PUT",
    headers: { "Content-Type": "image/png", "Content-Length": "10" },
    expiresAt: "2026-11-08T10:05:00.000Z",
  }
  const deps = (fetchImpl: typeof fetch) => ({ getAccessToken: async () => "token", fetchImpl, sleep: async () => undefined })

  it("presigns, PUTs without the bearer token, completes, and returns the product", async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, init })
      if (url.endsWith("/images/uploads")) return json(201, UPLOAD)
      if (url.startsWith("https://storage.test")) return new Response(null, { status: 200 })
      return json(200, PRODUCT)
    }
    const outcome = await uploadProductImage("p1", png(), deps(fetchImpl))
    assert.deepEqual(outcome, { state: "ok", product: PRODUCT })
    assert.ok(calls[0]?.url.endsWith("/api/v1/sellers/me/products/p1/images/uploads"))
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { contentType: "image/png", contentLength: 10 })
    assert.deepEqual(calls[1]?.init?.headers, { "Content-Type": "image/png" })
    assert.ok(calls[2]?.url.endsWith("/images/uploads/u1/complete"))
  })

  it("refuses SVG and oversized files before any request", async () => {
    const fetchImpl: typeof fetch = async () => assert.fail("no request expected")
    const svg = new File(["<svg/>"], "a.svg", { type: "image/svg+xml" })
    assert.equal((await uploadProductImage("p1", svg, deps(fetchImpl))).state, "unsupported-type")
    const big = new File([new Uint8Array(15_728_641)], "a.png", { type: "image/png" })
    assert.equal((await uploadProductImage("p1", big, deps(fetchImpl))).state, "too-large")
  })

  it("sends a phone photo over 2 MB to the server, unchanged, for normalization", async () => {
    const photo = new File([new Uint8Array(6_000_000)], "photo.jpg", { type: "image/jpeg" })
    const bodies: unknown[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      bodies.push(init?.body)
      if (url.endsWith("/images/uploads")) return json(201, { ...UPLOAD, headers: { "Content-Type": "image/jpeg", "Content-Length": "6000000" } })
      if (url.startsWith("https://storage.test")) return new Response(null, { status: 200 })
      return json(200, PRODUCT)
    }
    assert.equal((await uploadProductImage("p1", photo, deps(fetchImpl))).state, "ok")
    assert.deepEqual(JSON.parse(String(bodies[0])), { contentType: "image/jpeg", contentLength: 6_000_000 })
    assert.equal(bodies[1], photo)
  })

  it("retries completion while in progress; surfaces rejections and limits", async () => {
    let completes = 0
    const retrying: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith("/images/uploads")) return json(201, UPLOAD)
      if (url.startsWith("https://storage.test")) return new Response(null, { status: 200 })
      completes += 1
      return completes < 3 ? json(409, { error: { code: "PRODUCT_IMAGE_COMPLETION_IN_PROGRESS" } }) : json(200, PRODUCT)
    }
    assert.equal((await uploadProductImage("p1", png(), deps(retrying))).state, "ok")
    assert.equal(completes, 3)

    const answering =
      (status: number, code: string): typeof fetch =>
      async (input) => {
        const url = String(input)
        if (url.endsWith("/images/uploads")) return json(201, UPLOAD)
        if (url.startsWith("https://storage.test")) return new Response(null, { status: 200 })
        return json(status, { error: { code } })
      }
    assert.deepEqual(await uploadProductImage("p1", png(), deps(answering(422, "PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS"))), {
      state: "rejected",
      code: "PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS",
    })
    assert.equal((await uploadProductImage("p1", png(), deps(answering(409, "PRODUCT_IMAGE_LIMIT_REACHED")))).state, "limit-reached")
    assert.equal((await uploadProductImage("p1", png(), deps(answering(409, "PRODUCT_ARCHIVED")))).state, "archived")
    assert.equal((await uploadProductImage("p1", png(), deps(answering(410, "PRODUCT_IMAGE_UPLOAD_EXPIRED")))).state, "expired")
  })
})

describe("messages (French and Arabic)", () => {
  const keys = (value: unknown, prefix = ""): string[] =>
    typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
      : [prefix]

  it("both languages have the same keys and no empty text", () => {
    assert.deepEqual(keys(PRODUCT_MESSAGES.ar).sort(), keys(PRODUCT_MESSAGES.fr).sort())
    for (const locale of [PRODUCT_MESSAGES.fr, PRODUCT_MESSAGES.ar]) {
      const walk = (value: unknown): void => {
        if (typeof value === "string") assert.ok(value.trim().length > 0)
        else if (typeof value === "object" && value !== null) Object.values(value).forEach(walk)
      }
      walk(locale)
    }
  })

  it("Arabic texts are actually Arabic, and name every category and status", () => {
    const arabic = /[؀-ۿ]/
    for (const category of PRODUCT_CATEGORIES) {
      assert.ok(arabic.test(PRODUCT_MESSAGES.ar.categories[category]))
      assert.ok(PRODUCT_MESSAGES.fr.categories[category])
    }
    for (const status of PRODUCT_STATUSES) assert.ok(arabic.test(PRODUCT_MESSAGES.ar.status[status]))
    for (const text of [PRODUCT_MESSAGES.ar.restore, PRODUCT_MESSAGES.ar.restoreHint, PRODUCT_MESSAGES.ar.publishZeroStockNote, PRODUCT_MESSAGES.ar.outOfStockNote, PRODUCT_MESSAGES.ar.publish, PRODUCT_MESSAGES.ar.archive, PRODUCT_MESSAGES.ar.variantsTitle, PRODUCT_MESSAGES.ar.failures.forbidden]) {
      assert.ok(arabic.test(text))
    }
  })
})
