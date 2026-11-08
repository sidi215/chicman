import type { MetadataRoute } from "next"

import { configuredSiteUrl } from "@/features/storefront/seo"

/**
 * Without a public domain, this is not the site to index: canonical URLs would
 * point to a local or preview address. Private areas add nothing to search
 * results, and storefront pages stay open.
 */
export default function robots(): MetadataRoute.Robots {
  const baseUrl = configuredSiteUrl()
  if (baseUrl === null) return { rules: { userAgent: "*", disallow: "/" } }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/account", "/seller", "/admin", "/auth", "/login", "/register", "/forgot-password", "/missing-product"] },
    sitemap: `${baseUrl}/sitemap.xml`,
  }
}
