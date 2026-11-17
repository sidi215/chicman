import { z } from "zod";

import { plainText } from "../shops/schemas.js";
import {
  PRODUCT_CATEGORIES,
  PRODUCT_FIELD_LIMITS,
  PRODUCT_LIST_DEFAULT_PAGE_SIZE,
  PRODUCT_LIST_MAX_PAGE_SIZE,
  PRODUCT_PRICE_PATTERN,
  type ProductCategory,
} from "./product.js";

/** Public product discovery (spec 08). */

/**
 * Relevance (search only, spec 18), newest first (by publication), then price
 * in either direction.
 */
export const CATALOG_SORTS = ["relevance", "newest", "price_asc", "price_desc"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];
/** The sorts of a listing without a search query: relevance needs one. */
export const LISTING_SORTS = ["newest", "price_asc", "price_desc"] as const satisfies readonly CatalogSort[];
export const CATALOG_DEFAULT_SORT: CatalogSort = "newest";
/** The default order of a search (spec 18). */
export const CATALOG_SEARCH_DEFAULT_SORT: CatalogSort = "relevance";

/** The order used when the request names none: relevance for a search, else newest. */
export function defaultCatalogSort(query: string | null | undefined): CatalogSort {
  return query === undefined || query === null || query === "" ? CATALOG_DEFAULT_SORT : CATALOG_SEARCH_DEFAULT_SORT;
}

/** Longest search query, in characters after normalization (spec 18). */
export const CATALOG_SEARCH_MAX_LENGTH = 100;

/**
 * Search text as the server reads it: compatibility forms folded (NFKC, which
 * also maps Arabic presentation forms to letters), invisible formatting
 * characters such as direction marks removed, any run of spaces, line breaks,
 * or control characters made one space, and the ends trimmed. Case and Arabic
 * spelling variants are left to the search engine.
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/[\p{Cc}\s]+/gu, " ")
    .trim();
}

/** `q`: an empty query (after normalization) means no search. */
export const catalogSearchSchema = z
  .string()
  .max(CATALOG_SEARCH_MAX_LENGTH * 4)
  .transform(normalizeSearchText)
  .pipe(z.string().max(CATALOG_SEARCH_MAX_LENGTH));

/**
 * A price bound in MRU, as a decimal string normalized to two decimals
 * ("1500" → "1500.00"). Unlike a product price, zero is allowed.
 */
export const catalogPriceBoundSchema = z
  .string()
  .max(13)
  .regex(PRODUCT_PRICE_PATTERN)
  .transform((value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  });

/** Compares normalized bounds without floating point. */
export function isPriceRangeValid(minPrice: string | undefined, maxPrice: string | undefined): boolean {
  if (minPrice === undefined || maxPrice === undefined) return true;
  return minPrice.padStart(13, "0") <= maxPrice.padStart(13, "0");
}

export const catalogCategorySchema = z.enum(PRODUCT_CATEGORIES);
export const catalogSizeSchema = plainText(1, PRODUCT_FIELD_LIMITS.size);
export const catalogColorSchema = plainText(1, PRODUCT_FIELD_LIMITS.color);

/**
 * `GET /products` query string. Strict, so an unknown parameter is refused
 * rather than ignored.
 *
 * - `q` searches the public catalog (spec 18). It never widens the listing:
 *   the other filters and public visibility still apply.
 * - `sort` defaults to `relevance` with a query and `newest` without one;
 *   `relevance` without a query is refused.
 * - `availability=available` keeps only products that can be bought now. It is
 *   an explicit choice: without it, out-of-stock products are listed.
 * - `size` and `color` ignore case. Together they must match the same variant,
 *   and with `availability` that variant must also be in stock.
 */
export const catalogListQuerySchema = z
  .strictObject({
    q: catalogSearchSchema.optional(),
    category: catalogCategorySchema.optional(),
    minPrice: catalogPriceBoundSchema.optional(),
    maxPrice: catalogPriceBoundSchema.optional(),
    availability: z.literal("available").optional(),
    size: catalogSizeSchema.optional(),
    color: catalogColorSchema.optional(),
    sort: z.enum(CATALOG_SORTS).optional(),
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(PRODUCT_LIST_MAX_PAGE_SIZE).default(PRODUCT_LIST_DEFAULT_PAGE_SIZE),
  })
  .refine((query) => isPriceRangeValid(query.minPrice, query.maxPrice), { message: "minPrice is above maxPrice" })
  .refine((query) => query.sort !== "relevance" || (query.q ?? "") !== "", { message: "relevance needs a search query" })
  .transform(({ q, sort, ...rest }) => {
    const search = q === undefined || q === "" ? undefined : q;
    return { ...rest, ...(search === undefined ? {} : { q: search }), sort: sort ?? defaultCatalogSort(search) };
  });
export type CatalogListQuery = z.output<typeof catalogListQuerySchema>;

/** `GET /products/facets` query string. */
export const catalogFacetsQuerySchema = z.strictObject({ category: catalogCategorySchema.optional() });
export type CatalogFacetsQuery = z.output<typeof catalogFacetsQuerySchema>;

/** The shop as shown on a product card. */
export interface PublicShopSummary {
  id: string;
  name: string;
}

/** Public shop information. Contact details, the address, and the owner stay private. */
export interface PublicShopDetail extends PublicShopSummary {
  description: string;
  city: string;
  logoUrl: string | null;
}

/** Availability is exposed as a state only: stock quantities stay private. */
export interface PublicProductSummary {
  id: string;
  name: string;
  category: ProductCategory;
  brand: string | null;
  /** Decimal string in MRU, for example "1500.00". */
  price: string;
  /** `false` when the relevant stock is zero. The product stays listed. */
  available: boolean;
  /** Every public product has at least one image. */
  mainImageUrl: string;
  shop: PublicShopSummary;
}

export interface PublicProductImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

export interface PublicProductVariant {
  id: string;
  size: string | null;
  color: string | null;
  /** `false` when this variant's stock is zero. */
  available: boolean;
}

export interface PublicProductDetail extends Omit<PublicProductSummary, "shop"> {
  description: string;
  /** In display order: the first is the main image. */
  images: PublicProductImage[];
  variants: PublicProductVariant[];
  shop: PublicShopDetail;
}

/** How a search was answered (spec 18). */
export interface CatalogSearchInfo {
  /**
   * `true` when the search engine was unavailable and PostgreSQL answered with
   * a simpler text match (no typo tolerance; relevance falls back to newest).
   */
  degraded: boolean;
}

export interface PublicProductListResponse {
  products: PublicProductSummary[];
  page: number;
  pageSize: number;
  total: number;
  /** Present only for a search (`q`). */
  search?: CatalogSearchInfo;
}

/** Sizes and colors customers can filter by, ignoring case. */
export interface CatalogFacetsResponse {
  sizes: string[];
  colors: string[];
}
