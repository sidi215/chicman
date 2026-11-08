import type { PublicProductListResponse } from "@chicman/shared"
import type { Metadata } from "next"
import { Suspense } from "react"

import { catalogApiPath, filtersFromParams } from "@/features/storefront/catalog-query"
import { loadCatalog } from "@/features/storefront/catalog-server"
import { ProductGridSkeleton } from "@/features/storefront/components/product-card"
import { ProductListing } from "@/features/storefront/components/product-listing"
import { STOREFRONT_MESSAGES } from "@/features/storefront/messages"
import { canonicalListingHref, pageAlternates } from "@/features/storefront/seo"
import { currentLocale } from "@/lib/page-metadata"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function readFilters(searchParams: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)
  return filtersFromParams({ get: (name) => first(searchParams[name]) ?? null })
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const locale = await currentLocale()
  const t = STOREFRONT_MESSAGES[locale]
  const filters = readFilters(await searchParams)
  const heading = filters.category === null ? t.allProducts : t.categories[filters.category]
  const outcome = await loadCatalog<PublicProductListResponse>(catalogApiPath(filters))
  return {
    title: `${heading} · ${t.brand}`,
    description: t.heroBody,
    alternates: pageAlternates(canonicalListingHref(filters), locale),
    ...(outcome.state === "ok" ? {} : { robots: { index: false } }),
  }
}

async function Listing({ searchParams }: { searchParams: SearchParams }) {
  const filters = readFilters(await searchParams)
  return <ProductListing filters={filters} outcome={await loadCatalog<PublicProductListResponse>(catalogApiPath(filters))} />
}

export default async function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  const t = STOREFRONT_MESSAGES[await currentLocale()]
  return (
    <Suspense
      fallback={
        <main className="mx-auto w-full max-w-7xl flex-1 px-page-gutter py-6">
          <ProductGridSkeleton count={8} label={t.loading} />
        </main>
      }
    >
      <Listing searchParams={searchParams} />
    </Suspense>
  )
}
