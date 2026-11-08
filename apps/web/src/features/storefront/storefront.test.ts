import assert from "node:assert/strict"
import { describe, it } from "node:test"

import type { PublicProductDetail, PublicProductVariant } from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"
import { publicApiRequest } from "@/lib/api-client"
import { customerAddressHeaders } from "@/lib/customer-address"

import {
  activeFilterCount,
  catalogApiPath,
  changeCategory,
  changeFilters,
  clearFilters,
  facetsApiPath,
  filtersFromParams,
  interpretCatalogResult,
  listingHref,
  NO_FILTERS,
  pageCount,
  parsePriceRange,
} from "./catalog-query"
import { STOREFRONT_MESSAGES } from "./messages"
import { isMissingProduct, isProductId, productToCheck } from "./product-check"
import { canonicalListingHref, configuredSiteUrl, metaDescription, pageAlternates, productJsonLd, serializeJsonLd, siteUrl, sitemapEntries, sitemapStaticPaths } from "./seo"
import { colorOptions, isChosen, NO_CHOICE, selectVariant, sizeOptions, toggleChoice } from "./variant-selection"

const params = (text: string) => new URLSearchParams(text)

describe("listing URL state", () => {
  it("reads and writes every filter with the same parameter names as the API", () => {
    const url = "category=SHOES&minPrice=10.00&maxPrice=20.50&availability=available&size=M&color=Noir&sort=price_desc&page=3"
    const filters = filtersFromParams(params(url))
    assert.deepEqual(filters, {
      category: "SHOES",
      minPrice: "10.00",
      maxPrice: "20.50",
      availableOnly: true,
      size: "M",
      color: "Noir",
      sort: "price_desc",
      page: 3,
    })
    assert.equal(listingHref(filters), `/products?${url}`)
    assert.equal(catalogApiPath(filters), `/products?${url}`)
  })

  it("omits defaults", () => {
    assert.equal(listingHref(NO_FILTERS), "/products")
    assert.equal(catalogApiPath(NO_FILTERS), "/products")
    assert.equal(catalogApiPath(NO_FILTERS, 8), "/products?pageSize=8")
  })

  it("ignores invalid parameters instead of failing", () => {
    assert.deepEqual(filtersFromParams(params("category=BAGS&minPrice=abc&sort=popular&page=0&availability=maybe&size=")), NO_FILTERS)
    for (const page of ["1.5", "-2", "x", "9999999"]) assert.equal(filtersFromParams(params(`page=${page}`)).page, 1)
  })

  it("drops a maximum below the minimum, a range the API would refuse", () => {
    const filters = filtersFromParams(params("minPrice=50&maxPrice=10"))
    assert.equal(filters.minPrice, "50.00")
    assert.equal(filters.maxPrice, null)
  })

  it("encodes values safely", () => {
    const filters = { ...NO_FILTERS, color: "Bleu & vert" }
    assert.equal(filtersFromParams(params(listingHref(filters).split("?")[1] ?? "")).color, "Bleu & vert")
    assert.equal(catalogApiPath(filters).includes("\n"), false)
  })

  it("every change returns to the first page; page links keep filters and sorting", () => {
    const filters = { ...NO_FILTERS, category: "SHOES" as const, sort: "price_asc" as const, page: 4 }
    assert.equal(changeFilters(filters, { size: "M" }).page, 1)
    assert.equal(changeFilters(filters, { sort: "newest" }).page, 1)
    assert.equal(listingHref({ ...filters, page: 5 }), "/products?category=SHOES&sort=price_asc&page=5")
  })

  it("a new category clears size and color; the same category changes nothing", () => {
    const filters = { ...NO_FILTERS, category: "SHOES" as const, size: "40", color: "Noir", minPrice: "5.00", page: 2 }
    assert.deepEqual(changeCategory(filters, "CLOTHING"), { ...filters, category: "CLOTHING", size: null, color: null, page: 1 })
    assert.equal(changeCategory(filters, "SHOES"), filters)
  })

  it("clearing keeps the category and sort order", () => {
    const filters = { ...NO_FILTERS, category: "SHOES" as const, sort: "price_desc" as const, size: "40", availableOnly: true, page: 3 }
    assert.deepEqual(clearFilters(filters), { ...NO_FILTERS, category: "SHOES", sort: "price_desc" })
    assert.equal(activeFilterCount(filters), 2)
    assert.equal(activeFilterCount(clearFilters(filters)), 0)
  })

  it("facets follow the category", () => {
    assert.equal(facetsApiPath(null), "/products/facets")
    assert.equal(facetsApiPath("SHOES"), "/products/facets?category=SHOES")
  })

  it("counts pages", () => {
    assert.deepEqual([pageCount(0, 20), pageCount(20, 20), pageCount(21, 20)], [1, 1, 2])
  })
})

describe("price inputs", () => {
  it("accepts empty bounds, spaces, and a decimal comma", () => {
    assert.deepEqual(parsePriceRange("", ""), { ok: true, minPrice: null, maxPrice: null })
    assert.deepEqual(parsePriceRange("1 500,5", ""), { ok: true, minPrice: "1500.50", maxPrice: null })
    assert.deepEqual(parsePriceRange("0", "20"), { ok: true, minPrice: "0.00", maxPrice: "20.00" })
    assert.deepEqual(parsePriceRange("5", "5"), { ok: true, minPrice: "5.00", maxPrice: "5.00" })
  })

  it("refuses invalid values and an inverted range", () => {
    assert.deepEqual(parsePriceRange("abc", ""), { ok: false, error: "invalid-min" })
    assert.deepEqual(parsePriceRange("", "-1"), { ok: false, error: "invalid-max" })
    assert.deepEqual(parsePriceRange("1.234", ""), { ok: false, error: "invalid-min" })
    assert.deepEqual(parsePriceRange("100", "20"), { ok: false, error: "range" })
  })
})

describe("API results", () => {
  const interpret = (result: ApiResult<string>) => interpretCatalogResult(result).state
  it("classifies each outcome", () => {
    assert.deepEqual(interpretCatalogResult({ kind: "ok", status: 200, data: "x" }), { state: "ok", data: "x" })
    assert.equal(interpret({ kind: "error", status: 404, code: "PRODUCT_NOT_FOUND" }), "not-found")
    assert.equal(interpret({ kind: "error", status: 429, code: "RATE_LIMITED" }), "rate-limited")
    assert.equal(interpret({ kind: "error", status: 503, code: null }), "unavailable")
    assert.equal(interpret({ kind: "network-error" }), "unavailable")
    assert.equal(interpret({ kind: "error", status: 500, code: null }), "error")
    assert.equal(interpret({ kind: "unauthorized" }), "error")
  })

  it("a public request carries no token", async () => {
    let seen: RequestInit | undefined
    const result = await publicApiRequest<{ ok: boolean }>("/products", (async (_url: string, init?: RequestInit) => {
      seen = init
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch)
    assert.deepEqual(result, { kind: "ok", status: 200, data: { ok: true } })
    assert.equal(new Headers(seen?.headers).has("authorization"), false)
  })
})

const variant = (size: string | null, color: string | null, available: boolean, id = `${size}-${color}`): PublicProductVariant => ({ id, size, color, available })

describe("variant selection", () => {
  const variants = [variant("M", "Noir", true), variant("M", "Rouge", false), variant("L", "Rouge", true), variant("XL", "Noir", false)]

  it("needs a complete choice before it names a variant", () => {
    assert.deepEqual(selectVariant(variants, NO_CHOICE), { state: "incomplete" })
    assert.deepEqual(selectVariant(variants, { size: "M", color: null }), { state: "incomplete" })
    assert.deepEqual(selectVariant(variants, { size: null, color: "Noir" }), { state: "incomplete" })
  })

  it("identifies the chosen variant and its availability", () => {
    const available = selectVariant(variants, { size: "M", color: "Noir" })
    assert.equal(available.state === "selected" && available.variant.available, true)
    const sold = selectVariant(variants, { size: "M", color: "Rouge" })
    assert.equal(sold.state, "selected")
    assert.equal(sold.state === "selected" && sold.variant.available, false)
  })

  it("reports a combination the product does not sell", () => {
    assert.deepEqual(selectVariant(variants, { size: "L", color: "Noir" }), { state: "no-match" })
  })

  it("handles size-only and color-only variants", () => {
    const sizes = [variant("38", null, true), variant("40", null, false)]
    assert.equal(selectVariant(sizes, { size: "38", color: null }).state, "selected")
    const colors = [variant(null, "Noir", false)]
    const chosen = selectVariant(colors, { size: null, color: "noir" })
    assert.equal(chosen.state === "selected" && chosen.variant.available, false)
  })

  it("marks options by what can be bought with the other choice", () => {
    assert.deepEqual(sizeOptions(variants, NO_CHOICE), [
      { value: "M", available: true },
      { value: "L", available: true },
      { value: "XL", available: false },
    ])
    assert.deepEqual(sizeOptions(variants, { size: null, color: "Rouge" }), [
      { value: "M", available: false },
      { value: "L", available: true },
      { value: "XL", available: false },
    ])
    assert.deepEqual(colorOptions(variants, { size: "M", color: null }), [
      { value: "Noir", available: true },
      { value: "Rouge", available: false },
    ])
  })

  it("treats spellings of one value as one option", () => {
    const mixed = [variant("M", "Noir", false), variant("m", "Rouge", true)]
    assert.deepEqual(sizeOptions(mixed, NO_CHOICE), [{ value: "M", available: true }])
    assert.equal(isChosen("m", "M"), true)
    assert.equal(selectVariant(mixed, { size: "M", color: "Rouge" }).state, "selected")
  })

  it("selecting a chosen value clears it", () => {
    const choice = toggleChoice(NO_CHOICE, "size", "M")
    assert.deepEqual(choice, { size: "M", color: null })
    assert.deepEqual(toggleChoice(choice, "size", "m"), NO_CHOICE)
    assert.deepEqual(toggleChoice(choice, "color", "Noir"), { size: "M", color: "Noir" })
  })
})

describe("storefront texts", () => {
  it("French and Arabic have the same keys and differ", () => {
    const keys = (value: object): string[] =>
      Object.entries(value).flatMap(([key, entry]) => (typeof entry === "object" && entry !== null ? keys(entry).map((sub) => `${key}.${sub}`) : [key]))
    assert.deepEqual(keys(STOREFRONT_MESSAGES.ar).sort(), keys(STOREFRONT_MESSAGES.fr).sort())
    assert.notEqual(STOREFRONT_MESSAGES.ar.categories.SHOES, STOREFRONT_MESSAGES.fr.categories.SHOES)
  })
})

describe("search engine data", () => {
  const product = {
    id: "p1",
    name: "Robe </script><script>alert(1)</script>",
    description: "Une robe\nen coton",
    price: "1500.50",
    category: "CLOTHING",
    brand: null,
    available: false,
    images: [{ id: "i1", url: "https://media.example/a.webp" }],
    variants: [],
    shop: { id: "s1", name: "Boutique", description: "", city: "Nouakchott", logoUrl: null },
  } as unknown as PublicProductDetail

  it("gives each language its own canonical URL and links the versions", () => {
    const fr = pageAlternates("/products/p1", "fr")
    const ar = pageAlternates("/products/p1", "ar")
    assert.equal(fr.canonical, "/products/p1")
    assert.equal(ar.canonical, "/ar/products/p1")
    assert.deepEqual(ar.languages, { fr: "/products/p1", ar: "/ar/products/p1", "x-default": "/products/p1" })
  })

  it("treats filtered and sorted listings as their category's page", () => {
    const filters = { ...NO_FILTERS, category: "SHOES" as const, minPrice: "100", size: "M", sort: "price_asc" as const, page: 2 }
    assert.equal(canonicalListingHref(filters), "/products?category=SHOES&page=2")
    assert.equal(canonicalListingHref({ ...NO_FILTERS, availableOnly: true }), "/products")
  })

  it("describes a product without its stock, using the decimal price as sent", () => {
    const data = productJsonLd(product, "ar", "https://chicman.example")
    assert.equal(data.offers.price, "1500.50")
    assert.equal(data.offers.priceCurrency, "MRU")
    assert.equal(data.offers.availability, "https://schema.org/OutOfStock")
    assert.equal(data.offers.url, "https://chicman.example/ar/products/p1")
    assert.equal("brand" in data, false)
    assert.equal(JSON.stringify(data).includes("stock"), false)
  })

  it("cannot be broken out of its script tag by seller text", () => {
    const text = serializeJsonLd(productJsonLd(product, "fr"))
    assert.equal(text.includes("<"), false)
    assert.equal((JSON.parse(text) as { name: string }).name, product.name)
  })

  it("shortens long descriptions at a word, on one line", () => {
    assert.equal(metaDescription("Une robe\n\nen   coton"), "Une robe en coton")
    const long = metaDescription("mot ".repeat(100))
    assert.ok(long.length <= 160)
    assert.ok(long.endsWith("mot…"))
  })

  it("uses the configured site address", () => {
    assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: "https://chicman.example/" }), "https://chicman.example")
    assert.equal(siteUrl({}), "http://localhost:3000")
  })
})

describe("customer address sent to the API", () => {
  const env = { CATALOG_INTERNAL_KEY: "k".repeat(32) }

  it("sends nothing without the shared key, so the API sees this server", () => {
    assert.deepEqual(customerAddressHeaders({}, "203.0.113.9"), {})
  })

  it("sends the address added by the nearest proxy, not one the client wrote", () => {
    const sent = customerAddressHeaders(env, "198.51.100.1, 203.0.113.9")
    assert.equal(sent["x-chicman-client-address"], "203.0.113.9")
    assert.equal(sent["x-chicman-internal-key"], env.CATALOG_INTERNAL_KEY)
  })

  it("counts the configured proxies from the right", () => {
    const sent = customerAddressHeaders({ ...env, TRUST_PROXY_HOPS: "2" }, "198.51.100.1, 203.0.113.9, 192.0.2.7")
    assert.equal(sent["x-chicman-client-address"], "203.0.113.9")
  })

  it("sends nothing when the address is unknown", () => {
    assert.deepEqual(customerAddressHeaders(env, null), {})
    assert.deepEqual(customerAddressHeaders({ ...env, TRUST_PROXY_HOPS: "5" }, "203.0.113.9"), {})
  })
})

describe("real 404 for a missing product", () => {
  const ID = "14838829-eb45-4718-83a7-3d4ad8c16108"
  const answering = (status: number) => (async () => new Response(null, { status })) as typeof fetch

  it("only accepts UUIDs as product IDs, so a word cannot reach another API route", () => {
    assert.equal(isProductId(ID), true)
    assert.equal(isProductId("facets"), false)
    assert.equal(isProductId(`${ID}/x`), false)
  })

  it("checks full page loads and crawlers, not client navigations", () => {
    assert.deepEqual(productToCheck(`/fr/products/${ID}`, "document"), { locale: "fr", productId: ID })
    assert.deepEqual(productToCheck(`/ar/products/${ID}`, null), { locale: "ar", productId: ID })
    assert.equal(productToCheck(`/fr/products/${ID}`, "empty"), null)
  })

  it("ignores other pages", () => {
    for (const path of ["/fr/products", "/fr", "/fr/seller/products/x", `/fr/products/${ID}/more`]) assert.equal(productToCheck(path, null), null)
  })

  it("calls a product missing only when the API says so", async () => {
    assert.equal(await isMissingProduct(ID, { fetchImpl: answering(404) }), true)
    for (const status of [200, 429, 500, 503]) assert.equal(await isMissingProduct(ID, { fetchImpl: answering(status) }), false, String(status))
  })

  it("lets the page load when the API cannot be reached", async () => {
    const failing = (async () => {
      throw new Error("down")
    }) as typeof fetch
    assert.equal(await isMissingProduct(ID, { fetchImpl: failing }), false)
  })

  it("does not call the API for an invalid ID", async () => {
    const never = (async () => assert.fail("no request expected")) as typeof fetch
    assert.equal(await isMissingProduct("facets", { fetchImpl: never }), true)
  })
})

describe("search engine files", () => {
  it("opens only for a public HTTPS domain", () => {
    assert.equal(configuredSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://chicman.example/" }), "https://chicman.example")
    for (const value of [undefined, "", "http://chicman.example", "https://localhost:3000", "https://preview", "not a url"]) {
      assert.equal(configuredSiteUrl({ NEXT_PUBLIC_SITE_URL: value }), null, String(value))
    }
  })

  it("lists both languages of a page, each naming the other", () => {
    const [fr, ar] = sitemapEntries("https://c.example", "/products/p1")
    assert.equal(fr?.url, "https://c.example/products/p1")
    assert.equal(ar?.url, "https://c.example/ar/products/p1")
    assert.deepEqual(ar?.alternates?.languages, { fr: "https://c.example/products/p1", ar: "https://c.example/ar/products/p1" })
  })

  it("lists categories without filters or sorting", () => {
    assert.deepEqual(sitemapStaticPaths().slice(0, 3), ["/", "/products", "/products?category=CLOTHING"])
    assert.ok(sitemapStaticPaths().every((path) => !path.includes("sort") && !path.includes("page")))
  })
})
