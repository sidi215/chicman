import {
  CATALOG_DEFAULT_SORT,
  CATALOG_SORTS,
  catalogCategorySchema,
  catalogColorSchema,
  catalogPriceBoundSchema,
  catalogSizeSchema,
  isPriceRangeValid,
  type CatalogSort,
  type ProductCategory,
} from "@chicman/shared"

import type { ApiResult } from "@/lib/api-client"

import { normalizePriceInput } from "../products/product-form"

/**
 * The state of a product listing. It lives in the URL, so a listing can be
 * shared, reloaded, and reached again with the back button. Page URLs and API
 * queries use the same parameter names.
 */
export interface CatalogFilters {
  category: ProductCategory | null
  minPrice: string | null
  maxPrice: string | null
  availableOnly: boolean
  size: string | null
  color: string | null
  sort: CatalogSort
  page: number
}

export const NO_FILTERS: CatalogFilters = {
  category: null,
  minPrice: null,
  maxPrice: null,
  availableOnly: false,
  size: null,
  color: null,
  sort: CATALOG_DEFAULT_SORT,
  page: 1,
}

function valueOf<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } }, raw: string | null): T | null {
  if (raw === null) return null
  const result = schema.safeParse(raw)
  return result.success ? result.data : null
}

/** Reads a page URL. An invalid parameter is ignored, so a bad link still shows products. */
export function filtersFromParams(params: Pick<URLSearchParams, "get">): CatalogFilters {
  const minPrice = valueOf(catalogPriceBoundSchema, params.get("minPrice"))
  const maxPrice = valueOf(catalogPriceBoundSchema, params.get("maxPrice"))
  const rangeValid = isPriceRangeValid(minPrice ?? undefined, maxPrice ?? undefined)
  const sort = params.get("sort") as CatalogSort | null
  const page = Number(params.get("page"))
  return {
    category: valueOf(catalogCategorySchema, params.get("category")),
    minPrice,
    maxPrice: rangeValid ? maxPrice : null,
    availableOnly: params.get("availability") === "available",
    size: valueOf(catalogSizeSchema, params.get("size")),
    color: valueOf(catalogColorSchema, params.get("color")),
    sort: sort !== null && CATALOG_SORTS.includes(sort) ? sort : CATALOG_DEFAULT_SORT,
    page: Number.isInteger(page) && page >= 1 && page <= 1_000_000 ? page : 1,
  }
}

function toQuery(filters: CatalogFilters): string {
  const query = new URLSearchParams()
  if (filters.category !== null) query.set("category", filters.category)
  if (filters.minPrice !== null) query.set("minPrice", filters.minPrice)
  if (filters.maxPrice !== null) query.set("maxPrice", filters.maxPrice)
  if (filters.availableOnly) query.set("availability", "available")
  if (filters.size !== null) query.set("size", filters.size)
  if (filters.color !== null) query.set("color", filters.color)
  if (filters.sort !== CATALOG_DEFAULT_SORT) query.set("sort", filters.sort)
  if (filters.page > 1) query.set("page", String(filters.page))
  return query.toString()
}

/** The storefront URL of a listing. */
export function listingHref(filters: CatalogFilters): string {
  const query = toQuery(filters)
  return query === "" ? "/products" : `/products?${query}`
}

/** The API path of a listing; `pageSize` is optional and defaults on the server. */
export function catalogApiPath(filters: CatalogFilters, pageSize?: number): string {
  const query = new URLSearchParams(toQuery(filters))
  if (pageSize !== undefined) query.set("pageSize", String(pageSize))
  const text = query.toString()
  return text === "" ? "/products" : `/products?${text}`
}

export function facetsApiPath(category: ProductCategory | null): string {
  return category === null ? "/products/facets" : `/products/facets?category=${category}`
}

/** A filter or sort change returns to the first page, which always exists. */
export function changeFilters(filters: CatalogFilters, change: Partial<Omit<CatalogFilters, "page">>): CatalogFilters {
  return { ...filters, ...change, page: 1 }
}

/** Sizes and colors depend on the category, so a new category clears them. */
export function changeCategory(filters: CatalogFilters, category: ProductCategory | null): CatalogFilters {
  if (category === filters.category) return filters
  return changeFilters(filters, { category, size: null, color: null })
}

/** Clears the filters shown in the filter panel. The category and sort order remain. */
export function clearFilters(filters: CatalogFilters): CatalogFilters {
  return { ...NO_FILTERS, category: filters.category, sort: filters.sort }
}

export function activeFilterCount(filters: CatalogFilters): number {
  return [filters.minPrice, filters.maxPrice, filters.size, filters.color].filter((value) => value !== null).length + (filters.availableOnly ? 1 : 0)
}

export type PriceRangeResult =
  | { ok: true; minPrice: string | null; maxPrice: string | null }
  | { ok: false; error: "invalid-min" | "invalid-max" | "range" }

/** Reads the price inputs. An empty input means no bound; "1 500,50" is accepted. */
export function parsePriceRange(minText: string, maxText: string): PriceRangeResult {
  const read = (text: string) => {
    const value = normalizePriceInput(text)
    return value === "" ? ({ ok: true, value: null } as const) : catalogPriceBoundSchema.safeParse(value).success
      ? ({ ok: true, value: catalogPriceBoundSchema.parse(value) } as const)
      : ({ ok: false } as const)
  }
  const min = read(minText)
  if (!min.ok) return { ok: false, error: "invalid-min" }
  const max = read(maxText)
  if (!max.ok) return { ok: false, error: "invalid-max" }
  if (!isPriceRangeValid(min.value ?? undefined, max.value ?? undefined)) return { ok: false, error: "range" }
  return { ok: true, minPrice: min.value, maxPrice: max.value }
}

export type CatalogFailure = "not-found" | "rate-limited" | "unavailable" | "error"
export type CatalogOutcome<T> = { state: "ok"; data: T } | { state: CatalogFailure }

/** Public routes never answer 401 or 403 by design; anything unexpected is a plain error. */
export function interpretCatalogResult<T>(result: ApiResult<T>): CatalogOutcome<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data }
    case "network-error":
    case "auth-unavailable":
      return { state: "unavailable" }
    case "error":
      if (result.status === 404) return { state: "not-found" }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
    default:
      return { state: "error" }
  }
}

/** Number of pages of a listing; an empty listing has one. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}
