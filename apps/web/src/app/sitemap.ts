import type { PublicProductListResponse } from "@chicman/shared"
import type { MetadataRoute } from "next"
import { cacheLife } from "next/cache"
import { connection } from "next/server"

import { publicApiRequest } from "@/lib/api-client"
import { sitemapEntries, sitemapStaticPaths, SITEMAP_MAX_PRODUCTS, configuredSiteUrl } from "@/features/storefront/seo"

const PAGE_SIZE = 50

/**
 * Cached, so crawlers cannot turn this list into a stream of API calls. A
 * failure throws and is not cached: an error is better than a shortened list,
 * which would tell search engines that products are gone.
 */
async function publicProductIds(): Promise<string[]> {
  "use cache"
  cacheLife("hours")
  const ids: string[] = []
  for (let page = 1; ids.length < SITEMAP_MAX_PRODUCTS; page += 1) {
    const result = await publicApiRequest<PublicProductListResponse>(`/products?pageSize=${PAGE_SIZE}&page=${page}`, fetch, {
      baseUrl: process.env.API_INTERNAL_URL,
      signal: AbortSignal.timeout(8_000),
    })
    if (result.kind !== "ok") throw new Error("Sitemap: the catalog could not be read")
    ids.push(...result.data.products.map((product) => product.id))
    if (result.data.products.length === 0 || page * PAGE_SIZE >= result.data.total) break
  }
  return ids.slice(0, SITEMAP_MAX_PRODUCTS)
}

/** Empty until `NEXT_PUBLIC_SITE_URL` is a public HTTPS domain. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection()
  const baseUrl = configuredSiteUrl()
  if (baseUrl === null) return []
  const productPaths = (await publicProductIds()).map((id) => `/products/${id}`)
  return [...sitemapStaticPaths(), ...productPaths].flatMap((path) => sitemapEntries(baseUrl, path))
}
