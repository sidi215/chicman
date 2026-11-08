import type { PublicProductListResponse } from "@chicman/shared"
import type { Metadata } from "next"
import { Suspense } from "react"

import { CatalogFailureView } from "@/features/storefront/components/catalog-failure"
import { ProductGridSkeleton } from "@/features/storefront/components/product-card"
import { StorefrontHero, StorefrontSections } from "@/features/storefront/components/storefront-home"
import { loadCatalog } from "@/features/storefront/catalog-server"
import { HOME_SECTIONS, NEWEST_COUNT } from "@/features/storefront/home-sections"
import { STOREFRONT_MESSAGES } from "@/features/storefront/messages"
import { pageAlternates } from "@/features/storefront/seo"
import { currentLocale } from "@/lib/page-metadata"

export async function generateMetadata(): Promise<Metadata> {
  const locale = await currentLocale()
  const t = STOREFRONT_MESSAGES[locale]
  return { title: `${t.brand} · ${t.heroTitle}`, description: t.heroBody, alternates: pageAlternates("/", locale) }
}

async function HomeSections() {
  const outcomes = await Promise.all(HOME_SECTIONS.map(({ path }) => loadCatalog<PublicProductListResponse>(path)))
  const sections: PublicProductListResponse[] = []
  for (const outcome of outcomes) {
    if (outcome.state !== "ok") return <CatalogFailureView failure={outcome.state} />
    sections.push(outcome.data)
  }
  return <StorefrontSections sections={sections} />
}

export default async function HomePage() {
  const t = STOREFRONT_MESSAGES[await currentLocale()]
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-page-gutter py-6">
      <StorefrontHero />
      <Suspense fallback={<ProductGridSkeleton count={NEWEST_COUNT} label={t.loading} />}>
        <HomeSections />
      </Suspense>
    </main>
  )
}
