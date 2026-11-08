import { PRODUCT_CATEGORIES, type PublicProductDetail } from "@chicman/shared"
import type { Metadata, MetadataRoute } from "next"

import { DEFAULT_LOCALE, localizedPath, type Locale } from "@/lib/locale"

import { NO_FILTERS, listingHref, type CatalogFilters } from "./catalog-query"

const DESCRIPTION_LENGTH = 160

export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  return (env["NEXT_PUBLIC_SITE_URL"] || "http://localhost:3000").replace(/\/+$/, "")
}

/**
 * The site's address once it has a public domain: HTTPS and not a local name.
 * Search engine files stay closed until then.
 */
export function configuredSiteUrl(env: Record<string, string | undefined> = { NEXT_PUBLIC_SITE_URL: process.env["NEXT_PUBLIC_SITE_URL"] }): string | null {
  try {
    const url = new URL(env["NEXT_PUBLIC_SITE_URL"] ?? "")
    if (url.protocol !== "https:" || url.hostname === "localhost" || !url.hostname.includes(".")) return null
    return url.origin
  } catch {
    return null
  }
}

/** A sitemap file holds 50,000 URLs, and each product has two. */
export const SITEMAP_MAX_PRODUCTS = 24_000

/** Pages other than products. Filtered and sorted listings are not canonical, so they are left out. */
export function sitemapStaticPaths(): string[] {
  return ["/", "/products", ...PRODUCT_CATEGORIES.map((category) => listingHref({ ...NO_FILTERS, category }))]
}

/** One entry per language, each naming the other versions. */
export function sitemapEntries(baseUrl: string, path: string): MetadataRoute.Sitemap {
  const url = (locale: Locale) => `${baseUrl}${localizedPath(locale, path)}`
  const languages = { fr: url("fr"), ar: url("ar") }
  return [{ url: languages.fr, alternates: { languages } }, { url: languages.ar, alternates: { languages } }]
}

/** Canonical URL and language versions of a storefront page. */
export function pageAlternates(href: string, locale: Locale): NonNullable<Metadata["alternates"]> {
  return {
    canonical: localizedPath(locale, href),
    languages: {
      fr: localizedPath("fr", href),
      ar: localizedPath("ar", href),
      "x-default": localizedPath(DEFAULT_LOCALE, href),
    },
  }
}

/** Filters and sorting show the same products as the category, so only its pages are canonical. */
export function canonicalListingHref(filters: CatalogFilters): string {
  return listingHref({ ...NO_FILTERS, category: filters.category, page: filters.page })
}

/** One line of plain text, cut at a word, for search results. */
export function metaDescription(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  if (line.length <= DESCRIPTION_LENGTH) return line
  const cut = line.slice(0, DESCRIPTION_LENGTH - 1)
  const lastSpace = cut.lastIndexOf(" ")
  return `${lastSpace > 0 ? cut.slice(0, lastSpace) : cut}…`
}

export function productMetadata(product: PublicProductDetail, locale: Locale): Metadata {
  const title = `${product.name} · ${product.shop.name}`
  const description = metaDescription(product.description)
  const images = product.images.slice(0, 1).map((image) => image.url)
  return {
    title,
    description,
    alternates: pageAlternates(`/products/${product.id}`, locale),
    openGraph: { type: "website", title, description, images, url: localizedPath(locale, `/products/${product.id}`), locale },
  }
}

/** schema.org description of a product. Availability is a state: stock quantities stay private. */
export function productJsonLd(product: PublicProductDetail, locale: Locale, baseUrl: string = siteUrl()) {
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images.map((image) => image.url),
    ...(product.brand === null ? {} : { brand: { "@type": "Brand", name: product.brand } }),
    offers: {
      "@type": "Offer",
      url: `${baseUrl}${localizedPath(locale, `/products/${product.id}`)}`,
      price: product.price,
      priceCurrency: "MRU",
      availability: product.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      seller: { "@type": "Organization", name: product.shop.name },
    },
  }
}

/** Seller text ends up inside a script tag, so `<` is escaped: it cannot close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}
