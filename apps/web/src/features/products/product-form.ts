import {
  PRODUCT_ERROR_CODES,
  PRODUCT_MAX_STOCK,
  productCreateSchema,
  variantCreateSchema,
  variantUpdateSchema,
  type ProductCategory,
  type ProductVariantView,
  type SellerProductDetail,
} from "@chicman/shared"
import type { z } from "zod"

import type { ApiResult } from "@/lib/api-client"

/** Text fields of the product form. Stock has its own operation after creation. */
export const PRODUCT_FORM_FIELDS = ["name", "description", "category", "brand", "price"] as const
export type ProductFormField = (typeof PRODUCT_FORM_FIELDS)[number]
export type ProductFormValues = Record<ProductFormField, string>

export type ProductFieldErrorKey = "required" | "tooLong" | "invalid" | "invalidPrice"
export type ProductFieldErrors = Partial<Record<ProductFormField, ProductFieldErrorKey>>

/** Request bodies, built only from allowlisted keys. */
export type ProductCreateBody = z.output<typeof productCreateSchema>
export type ProductUpdateBody = Partial<Pick<ProductCreateBody, "name" | "description" | "category" | "price">> & { brand?: string | null }

export type FormResult<Body, Errors> = { ok: true; body: Body } | { ok: false; errors: Errors }

export function emptyProductForm(): ProductFormValues {
  return { name: "", description: "", category: "", brand: "", price: "" }
}

export function productFormValues(product: SellerProductDetail): ProductFormValues {
  return {
    name: product.name,
    description: product.description,
    category: product.category,
    brand: product.brand ?? "",
    price: product.price,
  }
}

/** New values for a form: fields still equal to `baseline` take `next`; other fields are unsaved edits and stay. */
export function mergeProductFormValues(current: ProductFormValues, baseline: ProductFormValues, next: ProductFormValues): ProductFormValues {
  const merged = { ...current }
  for (const field of PRODUCT_FORM_FIELDS) {
    if (current[field] === baseline[field]) merged[field] = next[field]
  }
  return merged
}

/** What sellers commonly type ("1 500,50") → the API's decimal form ("1500.50"). */
export function normalizePriceInput(value: string): string {
  return value.replace(/[\s  ]/g, "").replace(",", ".")
}

function errorsFrom(error: z.ZodError): ProductFieldErrors {
  const errors: ProductFieldErrors = {}
  for (const issue of error.issues) {
    const field = issue.path[0]
    if (typeof field !== "string" || !(PRODUCT_FORM_FIELDS as readonly string[]).includes(field)) continue
    const key = field as ProductFormField
    if (errors[key]) continue
    if (key === "price") errors[key] = "invalidPrice"
    else if (key === "category") errors[key] = "required"
    else if (issue.code === "too_small") errors[key] = "required"
    else if (issue.code === "too_big") errors[key] = "tooLong"
    else errors[key] = "invalid"
  }
  return errors
}

function parseProduct(values: ProductFormValues) {
  return productCreateSchema.safeParse({
    name: values.name,
    description: values.description,
    category: values.category,
    brand: values.brand.trim() === "" ? null : values.brand,
    price: normalizePriceInput(values.price),
  })
}

/** Stock as typed: a whole number within the limit, or `null`. */
export function parseStockInput(value: string): number | null {
  const trimmed = value.trim()
  if (!/^[0-9]+$/.test(trimmed)) return null
  const stock = Number(trimmed)
  return stock <= PRODUCT_MAX_STOCK ? stock : null
}

/** `POST /sellers/me/products`, validated with the same schema as the API. */
export function buildProductCreate(values: ProductFormValues, stockText: string): FormResult<ProductCreateBody, ProductFieldErrors & { stock?: "invalid" }> {
  const parsed = parseProduct(values)
  const stock = parseStockInput(stockText === "" ? "0" : stockText)
  if (!parsed.success || stock === null) {
    return { ok: false, errors: { ...(parsed.success ? {} : errorsFrom(parsed.error)), ...(stock === null ? { stock: "invalid" as const } : {}) } }
  }
  return { ok: true, body: { ...parsed.data, stock } }
}

/** `PATCH /sellers/me/products/:id`: only the fields that changed. */
export function buildProductUpdate(values: ProductFormValues, product: SellerProductDetail): FormResult<ProductUpdateBody, ProductFieldErrors> {
  const parsed = parseProduct(values)
  if (!parsed.success) return { ok: false, errors: errorsFrom(parsed.error) }
  const { name, description, category, brand, price } = parsed.data
  const body: ProductUpdateBody = {}
  if (name !== product.name) body.name = name
  if (description !== product.description) body.description = description
  if (category !== product.category) body.category = category as ProductCategory
  if ((brand ?? null) !== product.brand) body.brand = brand ?? null
  if (price !== product.price) body.price = price
  return { ok: true, body }
}

export interface VariantFormValues {
  size: string
  color: string
}
export type VariantErrorKey = "attributeRequired" | "tooLong" | "invalidStock"
const orNull = (value: string): string | null => (value.trim() === "" ? null : value)

function variantError(error: z.ZodError): VariantErrorKey {
  return error.issues.some((issue) => issue.code === "too_big") ? "tooLong" : "attributeRequired"
}

export function buildVariantCreate(values: VariantFormValues, stockText: string): FormResult<z.output<typeof variantCreateSchema>, VariantErrorKey> {
  const stock = parseStockInput(stockText === "" ? "0" : stockText)
  if (stock === null) return { ok: false, errors: "invalidStock" }
  const parsed = variantCreateSchema.safeParse({ size: orNull(values.size), color: orNull(values.color), stock })
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false, errors: variantError(parsed.error) }
}

/** `PATCH …/variants/:id`: only the attributes that changed. */
export function buildVariantUpdate(values: VariantFormValues, variant: ProductVariantView): FormResult<{ size?: string | null; color?: string | null }, VariantErrorKey> {
  const size = orNull(values.size)
  const color = orNull(values.color)
  if (size === null && color === null) return { ok: false, errors: "attributeRequired" }
  const body: { size?: string | null; color?: string | null } = {}
  if (size !== variant.size) body.size = size
  if (color !== variant.color) body.color = color
  if (Object.keys(body).length === 0) return { ok: true, body }
  const parsed = variantUpdateSchema.safeParse(body)
  return parsed.success ? { ok: true, body: parsed.data } : { ok: false, errors: variantError(parsed.error) }
}

/** The image order after moving one image by `delta` places, or `null` when it cannot move. */
export function moveImage(imageIds: readonly string[], imageId: string, delta: -1 | 1): string[] | null {
  const from = imageIds.indexOf(imageId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= imageIds.length) return null
  const next = [...imageIds]
  next.splice(from, 1)
  next.splice(to, 0, imageId)
  return next
}

/** What the product page offers in a status. The API enforces every rule. */
export interface ProductActions {
  editable: boolean
  canPublish: boolean
  /** A draft cannot be published until it has an image. */
  needsImageToPublish: boolean
  /** Zero stock does not block publication: the product shows as unavailable. */
  showZeroStockPublishNote: boolean
  /** A published product at zero stock stays visible until stock returns. */
  showOutOfStockNote: boolean
  canArchive: boolean
  canRestore: boolean
  /** A restored draft is not published, even if it was before. */
  showPublishedAt: boolean
}

export function productActions(product: Pick<SellerProductDetail, "status" | "available" | "images" | "publishedAt">): ProductActions {
  const draft = product.status === "DRAFT"
  const hasImage = product.images.length > 0
  return {
    editable: product.status !== "ARCHIVED",
    canPublish: draft && hasImage,
    needsImageToPublish: draft && !hasImage,
    showZeroStockPublishNote: draft && !product.available,
    showOutOfStockNote: product.status === "PUBLISHED" && !product.available,
    canArchive: product.status !== "ARCHIVED",
    canRestore: product.status === "ARCHIVED",
    showPublishedAt: !draft && product.publishedAt !== null,
  }
}

export type ProductFailure =
  | "signed-out"
  | "forbidden"
  | "not-found"
  | "invalid"
  | "archived"
  | "status-conflict"
  | "publish-requires-image"
  | "last-image"
  | "stock-conflict"
  | "stock-managed-by-variants"
  | "variant-exists"
  | "variant-limit"
  | "variant-attribute-required"
  | "image-limit"
  | "rate-limited"
  | "unavailable"
  | "error"

export type ProductOutcome<T> = { state: "ok"; data: T } | { state: ProductFailure }

const CONFLICTS: Record<string, ProductFailure> = {
  [PRODUCT_ERROR_CODES.archived]: "archived",
  [PRODUCT_ERROR_CODES.statusConflict]: "status-conflict",
  [PRODUCT_ERROR_CODES.publishRequiresImage]: "publish-requires-image",
  [PRODUCT_ERROR_CODES.lastImageRequired]: "last-image",
  [PRODUCT_ERROR_CODES.stockConflict]: "stock-conflict",
  [PRODUCT_ERROR_CODES.stockManagedByVariants]: "stock-managed-by-variants",
  [PRODUCT_ERROR_CODES.variantAlreadyExists]: "variant-exists",
  [PRODUCT_ERROR_CODES.variantLimitReached]: "variant-limit",
  [PRODUCT_ERROR_CODES.imageLimitReached]: "image-limit",
}

export function interpretProductResult<T>(result: ApiResult<T>): ProductOutcome<T> {
  switch (result.kind) {
    case "ok":
      return { state: "ok", data: result.data }
    case "unauthorized":
      return { state: "signed-out" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "forbidden":
      return { state: "forbidden" }
    case "error":
      if (result.status === 404) return { state: "not-found" }
      if (result.status === 400) {
        return { state: result.code === PRODUCT_ERROR_CODES.variantAttributeRequired ? "variant-attribute-required" : "invalid" }
      }
      if (result.status === 409) return { state: (result.code !== null ? CONFLICTS[result.code] : undefined) ?? "error" }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503) return { state: "unavailable" }
      return { state: "error" }
  }
}
