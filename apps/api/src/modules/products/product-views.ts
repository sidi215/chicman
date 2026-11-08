import type {
  ProductCategory,
  ProductImageContentType,
  ProductImageView,
  ProductStatus,
  SellerProductDetail,
  SellerProductSummary,
} from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { isStockAvailable, productAvailability } from "../inventory/availability.js";
import { productNotFound, type ProductSeller } from "./product-lock.js";

/** Builds the public URL of a media key. */
export type MediaUrl = (objectKey: string) => string;

export function mediaUrlBuilder(mediaPublicBaseUrl: string): MediaUrl {
  const base = mediaPublicBaseUrl.replace(/\/+$/, "");
  return (objectKey) => `${base}/${objectKey}`;
}

/** Active images in display order: the first is the main image. */
const activeImages = {
  where: { status: "ACTIVE" },
  orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
} satisfies Prisma.Product$imagesArgs;

export const productDetailInclude = {
  images: activeImages,
  variants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
} satisfies Prisma.ProductInclude;

export const productSummaryInclude = {
  images: { ...activeImages, take: 1, select: { objectKey: true } },
  variants: { select: { stock: true } },
} satisfies Prisma.ProductInclude;

type ProductBase = Prisma.ProductGetPayload<object>;

function summaryFields(
  product: ProductBase,
  variants: readonly { stock: number }[],
  mainImageKey: string | undefined,
  mediaUrl: MediaUrl,
): SellerProductSummary {
  const { stock, available } = productAvailability(product.stock, variants);
  return {
    id: product.id,
    name: product.name,
    category: product.category as ProductCategory,
    brand: product.brand,
    price: product.price.toFixed(2),
    status: product.status as ProductStatus,
    stock,
    available,
    variantCount: variants.length,
    mainImageUrl: mainImageKey === undefined ? null : mediaUrl(mainImageKey),
    publishedAt: product.publishedAt?.toISOString() ?? null,
    archivedAt: product.archivedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toProductSummary(
  product: Prisma.ProductGetPayload<{ include: typeof productSummaryInclude }>,
  mediaUrl: MediaUrl,
): SellerProductSummary {
  return summaryFields(product, product.variants, product.images[0]?.objectKey, mediaUrl);
}

export function toProductDetail(
  product: Prisma.ProductGetPayload<{ include: typeof productDetailInclude }>,
  mediaUrl: MediaUrl,
): SellerProductDetail {
  const images: ProductImageView[] = product.images.map((image) => ({
    id: image.id,
    url: mediaUrl(image.objectKey),
    position: image.position,
    contentType: image.contentType as ProductImageContentType,
    sizeBytes: image.sizeBytes,
    width: image.width,
    height: image.height,
  }));
  return {
    ...summaryFields(product, product.variants, product.images[0]?.objectKey, mediaUrl),
    description: product.description,
    images,
    variants: product.variants.map((variant) => ({
      id: variant.id,
      size: variant.size,
      color: variant.color,
      stock: variant.stock,
      available: isStockAvailable(variant.stock),
      createdAt: variant.createdAt.toISOString(),
      updatedAt: variant.updatedAt.toISOString(),
    })),
  };
}

/** Reads a product of this shop (inside or outside a transaction). */
export async function loadProductDetail(
  db: Prisma.TransactionClient,
  seller: ProductSeller,
  productId: string,
  mediaUrl: MediaUrl,
): Promise<SellerProductDetail> {
  const product = await db.product.findFirst({ where: { id: productId, shopId: seller.shopId }, include: productDetailInclude });
  if (product === null) throw productNotFound();
  return toProductDetail(product, mediaUrl);
}
