import { z } from "zod";

import {
  LOGO_CONTENT_TYPES,
  LOGO_MAX_BYTES,
  LOGO_MAX_DIMENSION,
  LOGO_MAX_INPUT_PIXELS,
  LOGO_MAX_UPLOAD_BYTES,
  LOGO_UPLOAD_URL_TTL_SECONDS,
} from "../shops/constants.js";
import { plainText } from "../shops/schemas.js";

/** Product management (spec 07). */

/** The only supported categories. Stored as a database enum. */
export const PRODUCT_CATEGORIES = ["CLOTHING", "SHOES", "FASHION_ACCESSORIES"] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/**
 * - `DRAFT`: not publicly visible.
 * - `PUBLISHED`: publicly visible while every publication condition holds.
 * - `ARCHIVED`: no longer offered for sale; read-only until restored, never deleted.
 *
 * Transitions: `DRAFT` → `PUBLISHED`, `DRAFT` or `PUBLISHED` → `ARCHIVED`, and
 * `ARCHIVED` → `DRAFT` (restore). Restoring never publishes.
 */
export const PRODUCT_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Field bounds, counted after NFC normalization and trimming. */
export const PRODUCT_FIELD_LIMITS = { name: 150, description: 5000, brand: 100, size: 30, color: 50 } as const;

/** Highest stock quantity of a product or a variant. */
export const PRODUCT_MAX_STOCK = 1_000_000;
export const PRODUCT_MAX_VARIANTS = 100;
export const PRODUCT_MAX_IMAGES = 10;
export const PRODUCT_LIST_MAX_PAGE_SIZE = 50;
export const PRODUCT_LIST_DEFAULT_PAGE_SIZE = 20;

/** Accepted formats, the same as shop logos (spec 07, section 5). */
export const PRODUCT_IMAGE_CONTENT_TYPES = LOGO_CONTENT_TYPES;
export type ProductImageContentType = (typeof PRODUCT_IMAGE_CONTENT_TYPES)[number];
/** Limits of the published image, which the server produces by normalizing the upload. */
export const PRODUCT_IMAGE_MAX_BYTES = LOGO_MAX_BYTES;
export const PRODUCT_IMAGE_MAX_DIMENSION = LOGO_MAX_DIMENSION;
/** Limits of the uploaded original, so phone photos can reach the server. 15 MB. */
export const PRODUCT_IMAGE_MAX_UPLOAD_BYTES = LOGO_MAX_UPLOAD_BYTES;
/** Checked from the file header before decoding: bounds memory against decompression bombs. */
export const PRODUCT_IMAGE_MAX_INPUT_PIXELS = LOGO_MAX_INPUT_PIXELS;
export const PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS = LOGO_UPLOAD_URL_TTL_SECONDS;

/** Terminal verification failures of a staged product image (`422`). */
export const PRODUCT_IMAGE_REJECTION_CODES = [
  "PRODUCT_IMAGE_TOO_LARGE",
  "PRODUCT_IMAGE_UNSUPPORTED_TYPE",
  "PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS",
  "PRODUCT_IMAGE_INVALID",
] as const;
export type ProductImageRejectionCode = (typeof PRODUCT_IMAGE_REJECTION_CODES)[number];

/**
 * Stable error codes of the product endpoints.
 *
 * - `PRODUCT_NOT_FOUND`, `PRODUCT_VARIANT_NOT_FOUND`, `PRODUCT_IMAGE_NOT_FOUND`
 *   (404): absent, or another shop's resource (never disclosed).
 * - `PRODUCT_STATUS_CONFLICT` (409): not allowed from the current status.
 * - `PRODUCT_ARCHIVED` (409): an archived product is read-only until restored.
 * - `PRODUCT_PUBLISH_REQUIRES_IMAGE` (409): publishing needs at least one image.
 * - `PRODUCT_LAST_IMAGE_REQUIRED` (409): a published product keeps one image.
 * - `PRODUCT_STOCK_MANAGED_BY_VARIANTS` (409): the product has variants.
 * - `PRODUCT_STOCK_CONFLICT` (409): `expectedStock` differs from the current
 *   stock; the client reloads and asks again.
 * - `PRODUCT_VARIANT_ALREADY_EXISTS` (409), `PRODUCT_VARIANT_LIMIT_REACHED` (409).
 * - `PRODUCT_VARIANT_ATTRIBUTE_REQUIRED` (400): a variant needs a size or a color.
 * - `PRODUCT_IMAGE_LIMIT_REACHED` (409), `PRODUCT_IMAGE_ORDER_INVALID` (400).
 * - `PRODUCT_IMAGE_UPLOAD_NOT_FOUND` (404), `PRODUCT_IMAGE_NOT_UPLOADED` (422,
 *   retryable), `PRODUCT_IMAGE_COMPLETION_IN_PROGRESS` (409, retry later),
 *   `PRODUCT_IMAGE_UPLOAD_EXPIRED` (410), `PRODUCT_IMAGE_STORAGE_UNAVAILABLE`
 *   (503), `PRODUCT_IMAGE_STORAGE_NOT_CONFIGURED` (503), plus the rejection
 *   codes (422).
 */
export const PRODUCT_ERROR_CODES = {
  notFound: "PRODUCT_NOT_FOUND",
  variantNotFound: "PRODUCT_VARIANT_NOT_FOUND",
  imageNotFound: "PRODUCT_IMAGE_NOT_FOUND",
  statusConflict: "PRODUCT_STATUS_CONFLICT",
  archived: "PRODUCT_ARCHIVED",
  publishRequiresImage: "PRODUCT_PUBLISH_REQUIRES_IMAGE",
  lastImageRequired: "PRODUCT_LAST_IMAGE_REQUIRED",
  stockManagedByVariants: "PRODUCT_STOCK_MANAGED_BY_VARIANTS",
  stockConflict: "PRODUCT_STOCK_CONFLICT",
  variantAlreadyExists: "PRODUCT_VARIANT_ALREADY_EXISTS",
  variantLimitReached: "PRODUCT_VARIANT_LIMIT_REACHED",
  variantAttributeRequired: "PRODUCT_VARIANT_ATTRIBUTE_REQUIRED",
  imageLimitReached: "PRODUCT_IMAGE_LIMIT_REACHED",
  imageOrderInvalid: "PRODUCT_IMAGE_ORDER_INVALID",
  imageUploadNotFound: "PRODUCT_IMAGE_UPLOAD_NOT_FOUND",
  imageNotUploaded: "PRODUCT_IMAGE_NOT_UPLOADED",
  imageCompletionInProgress: "PRODUCT_IMAGE_COMPLETION_IN_PROGRESS",
  imageUploadExpired: "PRODUCT_IMAGE_UPLOAD_EXPIRED",
  imageStorageUnavailable: "PRODUCT_IMAGE_STORAGE_UNAVAILABLE",
  imageStorageNotConfigured: "PRODUCT_IMAGE_STORAGE_NOT_CONFIGURED",
} as const;

/** Up to 10 integer digits and 2 decimals, the range of `DECIMAL(12, 2)`. */
const PRICE_PATTERN = /^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/;

/**
 * A price in MRU, as a decimal string ("1500" → "1500.00"). JSON numbers are
 * refused, so a price never passes through floating point. Must be above zero.
 */
export const productPriceSchema = z
  .string()
  .max(13)
  .regex(PRICE_PATTERN)
  .transform((value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return `${whole}.${fraction.padEnd(2, "0")}`;
  })
  .refine((value) => /[1-9]/.test(value), { message: "price must be above zero" });

const stockSchema = z.number().int().min(0).max(PRODUCT_MAX_STOCK);

const name = plainText(1, PRODUCT_FIELD_LIMITS.name);
const description = plainText(1, PRODUCT_FIELD_LIMITS.description, { multiline: true });
const brand = plainText(1, PRODUCT_FIELD_LIMITS.brand);
const category = z.enum(PRODUCT_CATEGORIES);
const size = plainText(1, PRODUCT_FIELD_LIMITS.size);
const color = plainText(1, PRODUCT_FIELD_LIMITS.color);

/*
 * Every object schema is strict: `shopId`, `status`, owner IDs, timestamps,
 * and other protected fields fail validation instead of being dropped.
 */

/** `POST /sellers/me/products`. A new product is always a `DRAFT`. */
export const productCreateSchema = z.strictObject({
  name,
  description,
  category,
  brand: brand.nullable().optional(),
  price: productPriceSchema,
  stock: stockSchema.optional(),
});
export type ProductCreateInput = z.output<typeof productCreateSchema>;

/** `PATCH /sellers/me/products/:productId`. Stock has its own operation. */
export const productUpdateSchema = z
  .strictObject({
    name: name.optional(),
    description: description.optional(),
    category: category.optional(),
    brand: brand.nullable().optional(),
    price: productPriceSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });
export type ProductUpdateInput = z.output<typeof productUpdateSchema>;

/** `GET /sellers/me/products` query string. */
export const productListQuerySchema = z.strictObject({
  status: z.enum(PRODUCT_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PRODUCT_LIST_MAX_PAGE_SIZE).default(PRODUCT_LIST_DEFAULT_PAGE_SIZE),
});
export type ProductListQuery = z.output<typeof productListQuerySchema>;

/**
 * Sets a stock quantity, only if it is still `expectedStock`. A stale screen
 * therefore cannot overwrite a newer value.
 */
export const stockUpdateSchema = z.strictObject({ stock: stockSchema, expectedStock: stockSchema });
export type StockUpdateInput = z.output<typeof stockUpdateSchema>;

/** A variant has a size, a color, or both. */
export const variantCreateSchema = z
  .strictObject({ size: size.nullable().optional(), color: color.nullable().optional(), stock: stockSchema.optional() })
  .refine((value) => (value.size ?? null) !== null || (value.color ?? null) !== null, { message: "a size or a color is required" });
export type VariantCreateInput = z.output<typeof variantCreateSchema>;

export const variantUpdateSchema = z
  .strictObject({ size: size.nullable().optional(), color: color.nullable().optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });
export type VariantUpdateInput = z.output<typeof variantUpdateSchema>;

/** `POST …/images/uploads`. The client never chooses a storage key. */
export const productImageUploadRequestSchema = z.strictObject({
  contentType: z.enum(PRODUCT_IMAGE_CONTENT_TYPES),
  contentLength: z.number().int().min(1).max(PRODUCT_IMAGE_MAX_UPLOAD_BYTES),
});
export type ProductImageUploadRequestInput = z.output<typeof productImageUploadRequestSchema>;

/** `PUT …/images/order`: every active image exactly once; the first is the main image. */
export const productImageOrderSchema = z.strictObject({
  imageIds: z
    .array(z.uuid())
    .min(1)
    .max(PRODUCT_MAX_IMAGES)
    .refine((ids) => new Set(ids).size === ids.length, { message: "duplicate image" }),
});
export type ProductImageOrderInput = z.output<typeof productImageOrderSchema>;

export interface ProductImageView {
  id: string;
  /** Public media URL. Never a presigned URL. */
  url: string;
  position: number;
  contentType: ProductImageContentType;
  sizeBytes: number;
  width: number;
  height: number;
}

export interface ProductVariantView {
  id: string;
  size: string | null;
  color: string | null;
  stock: number;
  /** `false` when this variant's stock is zero. */
  available: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields shared by the seller's list and detail views. */
export interface SellerProductSummary {
  id: string;
  name: string;
  category: ProductCategory;
  brand: string | null;
  /** Decimal string in MRU, for example "1500.00". */
  price: string;
  status: ProductStatus;
  /** Sum of the variants' stock when the product has variants, else its own stock. */
  stock: number;
  /** `false` when the relevant stock is zero. */
  available: boolean;
  variantCount: number;
  mainImageUrl: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SellerProductDetail extends SellerProductSummary {
  description: string;
  images: ProductImageView[];
  variants: ProductVariantView[];
}

export interface SellerProductListResponse {
  products: SellerProductSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/** `POST …/images/uploads` response. */
export interface ProductImageUploadResponse {
  uploadId: string;
  uploadUrl: string;
  method: "PUT";
  headers: { "Content-Type": ProductImageContentType; "Content-Length": string };
  expiresAt: string;
}
