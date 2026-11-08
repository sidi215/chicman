import {
  PRODUCT_ERROR_CODES,
  PRODUCT_IMAGE_CONTENT_TYPES,
  PRODUCT_IMAGE_MAX_UPLOAD_BYTES,
  PRODUCT_IMAGE_REJECTION_CODES,
  type ProductImageContentType,
  type ProductImageRejectionCode,
  type ProductImageUploadResponse,
  type SellerProductDetail,
} from "@chicman/shared"

import { apiRequest, type ApiResult } from "@/lib/api-client"

export type ImageUploadOutcome =
  | { state: "ok"; product: SellerProductDetail }
  /** Checked before uploading; the server verifies the real content anyway. */
  | { state: "unsupported-type" }
  | { state: "too-large" }
  | { state: "rejected"; code: ProductImageRejectionCode }
  | { state: "expired" }
  | { state: "limit-reached" }
  | { state: "archived" }
  | { state: "not-found" }
  | { state: "forbidden" }
  | { state: "signed-out" }
  | { state: "rate-limited" }
  | { state: "unavailable" }
  | { state: "error" }

export interface ImageUploadDeps {
  getAccessToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  /** Waits between completion retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

const COMPLETE_RETRIES = 3

function isImageType(type: string): type is ProductImageContentType {
  return (PRODUCT_IMAGE_CONTENT_TYPES as readonly string[]).includes(type)
}

function failure(result: Exclude<ApiResult<unknown>, { kind: "ok" }>): ImageUploadOutcome {
  switch (result.kind) {
    case "unauthorized":
      return { state: "signed-out" }
    case "forbidden":
      return { state: "forbidden" }
    case "auth-unavailable":
    case "network-error":
      return { state: "unavailable" }
    case "error":
      if (result.status === 400) return { state: "unsupported-type" }
      if (result.status === 404) return { state: "not-found" }
      if (result.status === 410) return { state: "expired" }
      if (result.status === 422) {
        const code = PRODUCT_IMAGE_REJECTION_CODES.find((candidate) => candidate === result.code)
        if (code) return { state: "rejected", code }
        // PRODUCT_IMAGE_NOT_UPLOADED: the PUT did not reach storage.
        return { state: "unavailable" }
      }
      if (result.status === 409 && result.code === PRODUCT_ERROR_CODES.imageLimitReached) return { state: "limit-reached" }
      if (result.status === 409 && result.code === PRODUCT_ERROR_CODES.archived) return { state: "archived" }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503 || result.status === 409) return { state: "unavailable" }
      return { state: "error" }
  }
}

/**
 * Product image upload (spec 07): request a presigned PUT, send the file
 * directly to the staging bucket, then ask the API to verify, normalize, and
 * publish it. The checks here only save a useless upload; the server decides,
 * and the resizing and metadata removal happen there. Completion is idempotent, so it is retried while
 * another attempt holds the lease.
 */
export async function uploadProductImage(productId: string, file: File, deps: ImageUploadDeps): Promise<ImageUploadOutcome> {
  if (!isImageType(file.type) || file.size === 0) return { state: "unsupported-type" }
  if (file.size > PRODUCT_IMAGE_MAX_UPLOAD_BYTES) return { state: "too-large" }
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const base = `/sellers/me/products/${encodeURIComponent(productId)}/images/uploads`

  const token = await deps.getAccessToken()
  if (!token) return { state: "signed-out" }
  const requested = await apiRequest<ProductImageUploadResponse>(
    base,
    token,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
    },
    fetchImpl
  )
  if (requested.kind !== "ok") return failure(requested)
  const upload = requested.data

  // Content-Length is set by the browser from the body; only the type is sent.
  // The bearer token is never sent to storage.
  try {
    const put = await fetchImpl(upload.uploadUrl, {
      method: upload.method,
      headers: { "Content-Type": upload.headers["Content-Type"] },
      body: file,
    })
    if (!put.ok) return { state: put.status === 403 ? "expired" : "unavailable" }
  } catch {
    return { state: "unavailable" }
  }

  for (let attempt = 0; ; attempt += 1) {
    const fresh = await deps.getAccessToken()
    if (!fresh) return { state: "signed-out" }
    const completed = await apiRequest<SellerProductDetail>(
      `${base}/${encodeURIComponent(upload.uploadId)}/complete`,
      fresh,
      { method: "POST" },
      fetchImpl
    )
    if (completed.kind === "ok") return { state: "ok", product: completed.data }
    const retryable =
      completed.kind === "error" &&
      ((completed.status === 409 && completed.code === PRODUCT_ERROR_CODES.imageCompletionInProgress) || completed.status === 503)
    if (!retryable || attempt >= COMPLETE_RETRIES) return failure(completed)
    await sleep(1000 * (attempt + 1))
  }
}
