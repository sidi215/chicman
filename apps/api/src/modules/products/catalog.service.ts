import {
  PRODUCT_ERROR_CODES,
  type CatalogFacetsQuery,
  type CatalogFacetsResponse,
  type CatalogListQuery,
  type CatalogSort,
  type ProductCategory,
  type PublicProductDetail,
  type PublicProductListResponse,
  type PublicProductSummary,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";
import { AVAILABLE_PRODUCT_WHERE, AVAILABLE_VARIANT_WHERE, isStockAvailable, productAvailability } from "../inventory/availability.js";
import { activeImages, mediaUrlBuilder, type MediaUrl } from "./product-views.js";
import { PUBLIC_PRODUCT_WHERE } from "./product-visibility.js";

/** The ID breaks ties, so pages never repeat or skip a product. */
const ORDER_BY: Record<CatalogSort, Prisma.ProductOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: "desc" }, { id: "desc" }],
  price_asc: [{ price: "asc" }, { id: "asc" }],
  price_desc: [{ price: "desc" }, { id: "desc" }],
};

/** Distinct values read for one facet; a far larger list would not be usable as filter chips. */
const FACET_LIMIT = 100;

const summaryInclude = {
  images: { ...activeImages, take: 1, select: { objectKey: true } },
  variants: { select: { stock: true } },
  shop: { select: { id: true, shopName: true } },
} satisfies Prisma.ProductInclude;

/** Selects public shop columns only, so private ones are never even loaded. */
const detailInclude = {
  images: activeImages,
  variants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  shop: { select: { id: true, shopName: true, description: true, city: true, logoUrl: true } },
} satisfies Prisma.ProductInclude;

/**
 * An exact match ignoring case. Prisma runs it as `ILIKE`, so the pattern
 * characters are escaped: `%` and `_` in a filter must only match themselves.
 */
const ignoringCase = (value: string): Prisma.StringNullableFilter<"ProductVariant"> => ({
  equals: value.replace(/[\\%_]/g, "\\$&"),
  mode: "insensitive",
});

/**
 * Public visibility is always the first condition and filters can only narrow
 * it (`AND`). Availability stays a separate, optional condition. Size, color,
 * and availability describe one variant when they are combined.
 */
export function catalogWhere(query: Omit<CatalogListQuery, "sort" | "page" | "pageSize">): Prisma.ProductWhereInput {
  const conditions: Prisma.ProductWhereInput[] = [PUBLIC_PRODUCT_WHERE];
  if (query.category !== undefined) conditions.push({ category: query.category });
  if (query.minPrice !== undefined) conditions.push({ price: { gte: query.minPrice } });
  if (query.maxPrice !== undefined) conditions.push({ price: { lte: query.maxPrice } });

  const available = query.availability === "available";
  if (query.size !== undefined || query.color !== undefined) {
    conditions.push({
      variants: {
        some: {
          ...(query.size === undefined ? {} : { size: ignoringCase(query.size) }),
          ...(query.color === undefined ? {} : { color: ignoringCase(query.color) }),
          ...(available ? AVAILABLE_VARIANT_WHERE : {}),
        },
      },
    });
  } else if (available) {
    conditions.push(AVAILABLE_PRODUCT_WHERE);
  }
  return { AND: conditions };
}

/** One spelling per value ignoring case, with sizes such as 38 and 40 in numeric order. */
function distinctValues(values: readonly (string | null)[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    if (value === null) continue;
    const key = value.toLocaleLowerCase("und");
    if (!byKey.has(key)) byKey.set(key, value);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, "und", { numeric: true, sensitivity: "base" }));
}

/** Read-only public catalog (spec 08). Needs no authenticated user. */
export class CatalogService {
  private readonly mediaUrl: MediaUrl;

  constructor(
    private readonly prisma: PrismaClient,
    mediaPublicBaseUrl: string,
  ) {
    this.mediaUrl = mediaUrlBuilder(mediaPublicBaseUrl);
  }

  async list(query: CatalogListQuery): Promise<PublicProductListResponse> {
    const where = catalogWhere(query);
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: summaryInclude,
        orderBy: ORDER_BY[query.sort],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      products: products.map((product) => this.toSummary(product)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Unknown and hidden products give the same `404`, so a hidden product is not disclosed. */
  async get(productId: string): Promise<PublicProductDetail> {
    const product = await this.prisma.product.findFirst({
      where: { AND: [PUBLIC_PRODUCT_WHERE, { id: productId }] },
      include: detailInclude,
    });
    if (product === null) throw notFound(PRODUCT_ERROR_CODES.notFound);
    const { shop } = product;
    return {
      ...this.baseFields(product, product.images[0]?.objectKey, product.variants),
      description: product.description,
      images: product.images.map((image) => ({ id: image.id, url: this.mediaUrl(image.objectKey), width: image.width, height: image.height })),
      variants: product.variants.map((variant) => ({
        id: variant.id,
        size: variant.size,
        color: variant.color,
        available: isStockAvailable(variant.stock),
      })),
      shop: { id: shop.id, name: shop.shopName, description: shop.description, city: shop.city, logoUrl: shop.logoUrl },
    };
  }

  async facets(query: CatalogFacetsQuery): Promise<CatalogFacetsResponse> {
    const product = catalogWhere(query);
    const [sizes, colors] = await Promise.all([
      this.prisma.productVariant.groupBy({
        by: ["size"],
        where: { size: { not: null }, product },
        orderBy: { size: "asc" },
        take: FACET_LIMIT,
      }),
      this.prisma.productVariant.groupBy({
        by: ["color"],
        where: { color: { not: null }, product },
        orderBy: { color: "asc" },
        take: FACET_LIMIT,
      }),
    ]);
    return { sizes: distinctValues(sizes.map(({ size }) => size)), colors: distinctValues(colors.map(({ color }) => color)) };
  }

  private toSummary(product: Prisma.ProductGetPayload<{ include: typeof summaryInclude }>): PublicProductSummary {
    return {
      ...this.baseFields(product, product.images[0]?.objectKey, product.variants),
      shop: { id: product.shop.id, name: product.shop.shopName },
    };
  }

  private baseFields(
    product: Prisma.ProductGetPayload<object>,
    mainImageKey: string | undefined,
    variants: readonly { stock: number }[],
  ): Omit<PublicProductSummary, "shop"> {
    return {
      id: product.id,
      name: product.name,
      category: product.category as ProductCategory,
      brand: product.brand,
      price: product.price.toFixed(2),
      available: productAvailability(product.stock, variants).available,
      // `PUBLIC_PRODUCT_WHERE` guarantees an active image.
      mainImageUrl: this.mediaUrl(mainImageKey ?? ""),
    };
  }
}
