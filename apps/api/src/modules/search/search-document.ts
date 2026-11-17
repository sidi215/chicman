import type { CatalogListQuery, CatalogSort, ProductCategory } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { isStockAvailable, productAvailability } from "../inventory/availability.js";

/**
 * The searchable product document (spec 18): public fields only. Stock
 * quantities, shop contact details, the address, the owner, statuses, and
 * every internal field stay in PostgreSQL. Availability is the public state,
 * as on a product card. Only products that pass `PUBLIC_PRODUCT_WHERE` get a
 * document (`search-indexer.ts`).
 */
export interface ProductSearchDocument {
  id: string;
  name: string;
  description: string;
  brand: string | null;
  category: ProductCategory;
  /** French and Arabic words for the category, so "chaussures" or "أحذية" find shoes. */
  categoryTerms: readonly string[];
  shopName: string;
  /**
   * Name, brand, and shop name with Arabic articles removed
   * (`withoutArabicArticles`); empty when that changes nothing.
   */
  nameForms: string;
  /** The description, the same way. */
  descriptionForms: string;
  /** The price in hundredths of an MRU: an integer, so filters and sorts never use floating point. */
  priceMinor: number;
  /** Publication time in milliseconds, for the "newest" sort. */
  publishedAt: number;
  available: boolean;
  /** Lower-case variant values (`variantKey`), any stock. */
  variantKeys: string[];
  /** The same, for in-stock variants only. */
  availableVariantKeys: string[];
}

/** Searched words for each category, in both languages (not display labels). */
export const CATEGORY_SEARCH_TERMS: Record<ProductCategory, readonly string[]> = {
  CLOTHING: ["vêtements", "vêtement", "habits", "ملابس", "لباس"],
  SHOES: ["chaussures", "chaussure", "أحذية", "حذاء"],
  FASHION_ACCESSORIES: ["accessoires", "accessoire", "إكسسوارات", "اكسسوارات"],
};

/**
 * Arabic prefixes stripped before matching: the article and its common
 * attached forms ("و", "ب", "ف", "ك" + "ال", and "لل"). Meilisearch folds
 * letter variants but not these, and typo tolerance cannot absorb two letters
 * in a short word, so "الملحفة" would miss "ملحفة". Applied the same way to
 * documents and queries, so both meet on the bare word.
 */
const ARABIC_ARTICLES = ["وال", "بال", "فال", "كال", "لل", "ال"] as const;
/** A stem must keep at least this many letters: "الى" or "الا" stay whole. */
const MIN_STEM = 3;

export function withoutArabicArticles(text: string): string {
  return text
    .split(/(\s+)/)
    .map((word) => {
      const article = ARABIC_ARTICLES.find((prefix) => word.startsWith(prefix) && [...word].length - prefix.length >= MIN_STEM);
      return article === undefined ? word : word.slice(article.length);
    })
    .join("");
}

/** The stripped form, or "" when there is no article to strip (no duplicate text in the index). */
function articleForms(text: string): string {
  const stripped = withoutArabicArticles(text);
  return stripped === text ? "" : stripped;
}

/** The columns a document needs, and no others. */
export const SEARCH_DOCUMENT_SELECT = {
  id: true,
  name: true,
  description: true,
  brand: true,
  category: true,
  price: true,
  stock: true,
  publishedAt: true,
  variants: { select: { size: true, color: true, stock: true } },
  shop: { select: { shopName: true } },
} satisfies Prisma.ProductSelect;

export type SearchDocumentSource = Prisma.ProductGetPayload<{ select: typeof SEARCH_DOCUMENT_SELECT }>;

/** Size and color filters ignore case, like the catalog's `ILIKE` match. */
const fold = (value: string) => value.toLowerCase();

/**
 * One key per filterable variant value: a size, a color, and a size with a
 * color together, since the catalog requires both to match the same variant.
 */
export function variantKey(size: string | undefined, color: string | undefined): string | null {
  if (size !== undefined && color !== undefined) return `pair:${JSON.stringify([fold(size), fold(color)])}`;
  if (size !== undefined) return `size:${fold(size)}`;
  if (color !== undefined) return `color:${fold(color)}`;
  return null;
}

function keysOf(variant: { size: string | null; color: string | null }): string[] {
  const size = variant.size ?? undefined;
  const color = variant.color ?? undefined;
  return [variantKey(size, undefined), variantKey(undefined, color), variantKey(size, color)].filter((key): key is string => key !== null);
}

/** Hundredths of an MRU from a decimal string with at most two decimals ("1500.5" → 150050). */
export function priceToMinor(price: string): number {
  const [whole = "0", fraction = ""] = price.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function toSearchDocument(product: SearchDocumentSource): ProductSearchDocument {
  const category = product.category as ProductCategory;
  const unique = (values: string[]) => [...new Set(values)].sort();
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    brand: product.brand,
    category,
    categoryTerms: CATEGORY_SEARCH_TERMS[category],
    shopName: product.shop.shopName,
    nameForms: articleForms([product.name, product.brand, product.shop.shopName].filter((part) => part !== null && part !== "").join(" ")),
    descriptionForms: articleForms(product.description),
    priceMinor: priceToMinor(product.price.toFixed(2)),
    publishedAt: product.publishedAt?.getTime() ?? 0,
    available: productAvailability(product.stock, product.variants).available,
    variantKeys: unique(product.variants.flatMap(keysOf)),
    availableVariantKeys: unique(product.variants.filter((variant) => isStockAvailable(variant.stock)).flatMap(keysOf)),
  };
}

/**
 * Index settings. Only `id` is displayed: the API reads every shown field from
 * PostgreSQL. `sort` ranks first so an explicit price or date order is
 * followed exactly; with relevance no sort is sent and the text rules decide.
 * Meilisearch's tokenizer folds case and accents and normalizes Arabic letter
 * variants (alef forms, teh marbuta, tatweel, diacritics); Arabic articles are
 * handled by `withoutArabicArticles`.
 */
export const PRODUCT_INDEX_SETTINGS = {
  searchableAttributes: ["name", "brand", "shopName", "nameForms", "categoryTerms", "description", "descriptionForms"],
  displayedAttributes: ["id"],
  filterableAttributes: ["category", "priceMinor", "available", "variantKeys", "availableVariantKeys"],
  sortableAttributes: ["priceMinor", "publishedAt", "id"],
  rankingRules: ["sort", "words", "typo", "proximity", "attribute", "exactness"],
  pagination: { maxTotalHits: 5000 },
} as const;

/** A value inside a Meilisearch filter string: quoted, with quotes and backslashes escaped. */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, "\\$&")}"`;
}

/**
 * The index filter for a validated catalog query. Built only from the parsed
 * fields of `catalogListQuerySchema`, never from client text, so a client
 * cannot add conditions. It mirrors `catalogWhere`; visibility is not in it,
 * because every result is checked again in PostgreSQL with
 * `PUBLIC_PRODUCT_WHERE` (the index is never an authorization layer).
 */
export function searchFilter(query: Omit<CatalogListQuery, "sort" | "page" | "pageSize" | "q">): string[] {
  const filter: string[] = [];
  if (query.category !== undefined) filter.push(`category = ${quoteFilterValue(query.category)}`);
  if (query.minPrice !== undefined) filter.push(`priceMinor >= ${priceToMinor(query.minPrice)}`);
  if (query.maxPrice !== undefined) filter.push(`priceMinor <= ${priceToMinor(query.maxPrice)}`);
  const available = query.availability === "available";
  const key = variantKey(query.size, query.color);
  if (key !== null) filter.push(`${available ? "availableVariantKeys" : "variantKeys"} = ${quoteFilterValue(key)}`);
  else if (available) filter.push("available = true");
  return filter;
}

/** The index sort for a catalog sort; the ID breaks ties as in PostgreSQL. */
export const SEARCH_SORT: Record<CatalogSort, string[] | undefined> = {
  relevance: undefined,
  newest: ["publishedAt:desc", "id:desc"],
  price_asc: ["priceMinor:asc", "id:asc"],
  price_desc: ["priceMinor:desc", "id:desc"],
};
