"use client"

import type { PublicProductListResponse } from "@chicman/shared"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

import { listingHref, NO_FILTERS } from "../catalog-query"
import { useStorefrontMessages, type StorefrontMessages } from "../messages"
import { HOME_SECTIONS, type HomeSection } from "../home-sections"
import { ProductGrid } from "./product-card"

function Section({ section, data, t }: { section: HomeSection; data: PublicProductListResponse; t: StorefrontMessages }) {
  const locale = useLocale()
  const title = section.id === "newest" ? t.newest : t.categories[section.id]
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="type-headline-small">{title}</h2>
        <Link href={localizedPath(locale, listingHref(section.filters))} aria-label={`${t.seeAll} : ${title}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          {t.seeAll}
        </Link>
      </div>
      <ProductGrid products={data.products} t={t} />
    </section>
  )
}

export function StorefrontHero() {
  const t = useStorefrontMessages()
  const locale = useLocale()
  return (
    <section className="flex flex-col items-start gap-3 rounded-2xl bg-highlight p-6 text-highlight-foreground md:p-10">
      <h1 className="type-display-small max-w-xl">{t.heroTitle}</h1>
      <p className="type-body-large max-w-xl">{t.heroBody}</p>
      <Link href={localizedPath(locale, listingHref(NO_FILTERS))} className={buttonVariants()}>
        {t.heroAction}
      </Link>
    </section>
  )
}

/** The newest products, then a section per category that has products. */
export function StorefrontSections({ sections }: { sections: readonly PublicProductListResponse[] }) {
  const t = useStorefrontMessages()
  if (sections.every((data) => data.products.length === 0)) {
    return <p className="type-body-medium text-muted-foreground">{t.emptyCatalog}</p>
  }
  return HOME_SECTIONS.map((section, index) => {
    const data = sections[index]
    return data === undefined || data.products.length === 0 ? null : <Section key={section.id} section={section} data={data} t={t} />
  })
}
