"use client"

import { type CatalogSort, type PublicProductListResponse } from "@chicman/shared"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useId, useTransition } from "react"

import { buttonVariants } from "@/components/ui/button"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { cn } from "@/lib/utils"

import {
  activeFilterCount,
  changeFilters,
  changeSearch,
  clearFilters,
  listingHref,
  pageCount,
  sortOptions,
  type CatalogFilters,
  type CatalogOutcome,
} from "../catalog-query"
import { useStorefrontMessages, type StorefrontMessages } from "../messages"
import { CatalogFailureView } from "./catalog-failure"
import { CatalogFiltersPanel } from "./catalog-filters"
import { ProductGrid } from "./product-card"

function SortControl({
  value,
  options,
  onChange,
  t,
}: {
  value: CatalogSort
  options: readonly CatalogSort[]
  onChange: (sort: CatalogSort) => void
  t: StorefrontMessages
}) {
  const id = useId()
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="type-label-large whitespace-nowrap">
        {t.sortLabel}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value as CatalogSort)}
        className="h-control-sm min-w-0 rounded-full border border-border bg-surface px-3 type-body-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {options.map((sort) => (
          <option key={sort} value={sort}>
            {t.sorts[sort]}
          </option>
        ))}
      </select>
    </div>
  )
}

/** A sentence with the customer's search in it, isolated so Arabic and French text mix correctly. */
function SearchHeading({ template, query }: { template: string; query: string }) {
  const [before = "", after = ""] = template.split("{query}")
  return (
    <>
      {before}
      <bdi>{query}</bdi>
      {after}
    </>
  )
}

/** Page links keep every filter and the sort order, because they come from the same state. */
function Pagination({ filters, pages, t }: { filters: CatalogFilters; pages: number; t: StorefrontMessages }) {
  const locale = useLocale()
  const { page } = filters
  const link = (target: number, label: string, enabled: boolean) =>
    enabled ? (
      <Link href={localizedPath(locale, listingHref({ ...filters, page: target }))} className={buttonVariants({ variant: "outline", size: "sm" })}>
        {label}
      </Link>
    ) : (
      <span aria-disabled className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
        {label}
      </span>
    )
  return (
    <nav aria-label={t.pagination} className="flex items-center justify-between gap-3">
      {link(page - 1, t.previousPage, page > 1)}
      <span className="type-body-small text-muted-foreground">{t.pageOf.replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
      {link(page + 1, t.nextPage, page < pages)}
    </nav>
  )
}

/**
 * A product listing, rendered by the server from the URL. A change of filter
 * or sort navigates; the current products stay until the new ones are ready.
 */
export function ProductListing({ filters, outcome }: { filters: CatalogFilters; outcome: CatalogOutcome<PublicProductListResponse> }) {
  const t = useStorefrontMessages()
  const locale = useLocale()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const update = (next: CatalogFilters) => startTransition(() => router.push(localizedPath(locale, listingHref(next)), { scroll: false }))
  const data = outcome.state === "ok" ? outcome.data : null
  const { search } = filters
  const heading = filters.category === null ? t.allProducts : t.categories[filters.category]
  const withoutSearch = changeSearch(filters, "")

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-medium">
            {search === null ? heading : <SearchHeading template={t.searchHeading} query={search} />}
          </h1>
          <p role="status" className="type-body-small text-muted-foreground">
            {data === null ? " " : t.resultCount.replace("{count}", String(data.total))}
          </p>
        </div>
        <SortControl value={filters.sort} options={sortOptions(search)} onChange={(sort) => update(changeFilters(filters, { sort }))} t={t} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
        <CatalogFiltersPanel filters={filters} onChange={update} t={t} />
        <div aria-busy={pending} className={cn("flex min-w-0 flex-col gap-4 transition-opacity", pending && "opacity-60")}>
          {outcome.state !== "ok" ? <CatalogFailureView failure={outcome.state} /> : null}
          {data?.search?.degraded === true ? (
            <p role="status" className="rounded-md border border-border bg-muted px-4 py-3 type-body-small text-muted-foreground">
              {t.searchDegraded}
            </p>
          ) : null}
          {data !== null && data.products.length === 0 ? (
            <div className="flex flex-col items-start gap-3">
              {data.total > 0 ? (
                <>
                  <p className="type-body-medium text-muted-foreground">{t.pastEnd}</p>
                  <Link href={localizedPath(locale, listingHref({ ...filters, page: 1 }))} className={buttonVariants({ variant: "outline" })}>
                    {t.firstPage}
                  </Link>
                </>
              ) : search !== null ? (
                <>
                  <p className="type-body-medium text-muted-foreground">
                    <SearchHeading template={t.emptySearch} query={search} />
                  </p>
                  <p className="type-body-small text-muted-foreground">{t.emptySearchHint}</p>
                  <div className="flex flex-wrap gap-2">
                    {withoutSearch !== null ? (
                      <Link href={localizedPath(locale, listingHref(withoutSearch))} className={buttonVariants({ variant: "outline" })}>
                        {t.searchClear}
                      </Link>
                    ) : null}
                    {activeFilterCount(filters) > 0 ? (
                      <Link href={localizedPath(locale, listingHref(clearFilters(filters)))} className={buttonVariants({ variant: "outline" })}>
                        {t.clearFilters}
                      </Link>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <p className="type-body-medium text-muted-foreground">{activeFilterCount(filters) > 0 ? t.emptyFiltered : t.emptyCatalog}</p>
                  {activeFilterCount(filters) > 0 ? (
                    <Link href={localizedPath(locale, listingHref(clearFilters(filters)))} className={buttonVariants({ variant: "outline" })}>
                      {t.clearFilters}
                    </Link>
                  ) : null}
                </>
              )}
            </div>
          ) : null}
          {data !== null && data.products.length > 0 ? (
            <>
              <ProductGrid products={data.products} t={t} />
              <Pagination filters={filters} pages={pageCount(data.total, data.pageSize)} t={t} />
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}
