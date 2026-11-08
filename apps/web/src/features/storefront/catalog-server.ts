import { headers } from "next/headers"
import { cache } from "react"

import { publicApiRequest } from "@/lib/api-client"
import { customerAddressHeaders } from "@/lib/customer-address"

import { interpretCatalogResult, type CatalogOutcome } from "./catalog-query"

/** A page must not wait forever for the API: it shows its failure state instead. */
const API_TIMEOUT_MS = 8_000

/**
 * Reads a public API path while rendering a page. Results are not cached, so a
 * suspended shop's products and changes in stock show on the next request. A
 * path is read once per request, so metadata and the page share one result.
 */
export const loadCatalog = cache(async function loadCatalog<T>(path: string): Promise<CatalogOutcome<T>> {
  const forwardedFor = (await headers()).get("x-forwarded-for")
  const result = await publicApiRequest<T>(path, fetch, {
    baseUrl: process.env.API_INTERNAL_URL,
    headers: customerAddressHeaders(process.env, forwardedFor),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  })
  return interpretCatalogResult(result)
}) as <T>(path: string) => Promise<CatalogOutcome<T>>
