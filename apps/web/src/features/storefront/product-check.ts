import { getApiBaseUrl } from "@/lib/api-client"

const PRODUCT_PATH = /^\/([a-z]{2})\/products\/([^/]+)$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHECK_TIMEOUT_MS = 1_500

/** Product IDs are UUIDs. Anything else, such as `facets`, would reach other API routes. */
export function isProductId(value: string): boolean {
  return UUID.test(value)
}

/**
 * The product of an internal route, when a real status can still be returned.
 * Only full page loads: client navigations render the page's own not-found
 * view, and browsers mark them with another `Sec-Fetch-Dest`. Crawlers send none.
 */
export function productToCheck(internalPath: string, fetchDest: string | null): { locale: string; productId: string } | null {
  if (fetchDest !== null && fetchDest !== "document") return null
  const match = PRODUCT_PATH.exec(internalPath)
  if (match === null) return null
  const [, locale = "", productId = ""] = match
  return { locale, productId }
}

/**
 * `true` only when the API says the product does not exist publicly. On any
 * other result, the page loads as usual and reports the failure itself, so a
 * short API problem never tells search engines that a product is gone.
 */
export async function isMissingProduct(
  productId: string,
  options: { baseUrl?: string | undefined; headers?: Record<string, string>; fetchImpl?: typeof fetch } = {}
): Promise<boolean> {
  if (!isProductId(productId)) return true
  const baseUrl = options.baseUrl?.replace(/\/+$/, "") || getApiBaseUrl()
  try {
    const response = await (options.fetchImpl ?? fetch)(`${baseUrl}/api/v1/products/${productId}`, {
      method: "HEAD",
      headers: options.headers ?? {},
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    return response.status === 404
  } catch {
    return false
  }
}
