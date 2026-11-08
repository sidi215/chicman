import {
  LOGO_CONTENT_TYPES,
  LOGO_MAX_UPLOAD_BYTES,
  LOGO_REJECTION_CODES,
  SHOP_ERROR_CODES,
  type LogoCompleteResponse,
  type LogoContentType,
  type LogoRejectionCode,
  type LogoUploadResponse,
} from "@chicman/shared"

import { apiRequest, type ApiResult } from "@/lib/api-client"

export type LogoUploadOutcome =
  | { state: "ok"; logoUrl: string }
  /** Checked before uploading; the server verifies the real content anyway. */
  | { state: "unsupported-type" }
  | { state: "too-large" }
  | { state: "rejected"; code: LogoRejectionCode }
  | { state: "expired" }
  | { state: "forbidden" }
  | { state: "signed-out" }
  | { state: "rate-limited" }
  | { state: "unavailable" }
  | { state: "error" }

export interface LogoUploadDeps {
  getAccessToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
  /** Waits between completion retries (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
}

const COMPLETE_RETRIES = 3

function isLogoType(type: string): type is LogoContentType {
  return (LOGO_CONTENT_TYPES as readonly string[]).includes(type)
}

function failure(result: Exclude<ApiResult<unknown>, { kind: "ok" }>): LogoUploadOutcome {
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
      if (result.status === 410) return { state: "expired" }
      if (result.status === 422) {
        const code = LOGO_REJECTION_CODES.find((candidate) => candidate === result.code)
        if (code) return { state: "rejected", code }
        // LOGO_NOT_UPLOADED: the PUT did not reach storage.
        return { state: "unavailable" }
      }
      if (result.status === 429) return { state: "rate-limited" }
      if (result.status === 503 || result.status === 409) return { state: "unavailable" }
      return { state: "error" }
  }
}

/**
 * Shop logo upload (spec 06): request a presigned PUT, send the file
 * directly to the staging bucket, then ask the API to verify, normalize, and
 * publish it. The checks here only save a useless upload; the server decides.
 * Completion is idempotent, so it is retried while another attempt
 * holds the lease (`409 LOGO_COMPLETION_IN_PROGRESS`).
 */
export async function uploadShopLogo(file: File, deps: LogoUploadDeps): Promise<LogoUploadOutcome> {
  if (!isLogoType(file.type)) return { state: "unsupported-type" }
  if (file.size > LOGO_MAX_UPLOAD_BYTES || file.size === 0) return { state: file.size === 0 ? "unsupported-type" : "too-large" }
  const fetchImpl = deps.fetchImpl ?? fetch
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  const token = await deps.getAccessToken()
  if (!token) return { state: "signed-out" }
  const requested = await apiRequest<LogoUploadResponse>(
    "/sellers/me/shop/logo/uploads",
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
    const completed = await apiRequest<LogoCompleteResponse>(
      `/sellers/me/shop/logo/uploads/${encodeURIComponent(upload.uploadId)}/complete`,
      fresh,
      { method: "POST" },
      fetchImpl
    )
    if (completed.kind === "ok") return { state: "ok", logoUrl: completed.data.logoUrl }
    const retryable =
      completed.kind === "error" &&
      ((completed.status === 409 && completed.code === SHOP_ERROR_CODES.logoCompletionInProgress) || completed.status === 503)
    if (!retryable || attempt >= COMPLETE_RETRIES) return failure(completed)
    await sleep(1000 * (attempt + 1))
  }
}
