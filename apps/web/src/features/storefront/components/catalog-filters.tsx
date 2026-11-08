"use client"

import { PRODUCT_CATEGORIES, type CatalogFacetsResponse, type ProductCategory } from "@chicman/shared"
import { SlidersHorizontal } from "lucide-react"
import { useState, type FormEvent, type ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { FormField } from "@/features/auth/components/form-field"
import { cn } from "@/lib/utils"

import { activeFilterCount, changeCategory, changeFilters, clearFilters, facetsApiPath, parsePriceRange, type CatalogFilters, type PriceRangeResult } from "../catalog-query"
import type { StorefrontMessages } from "../messages"
import { useCatalogRequest } from "../use-catalog-request"

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 type-label-large">{title}</legend>
      {children}
    </fieldset>
  )
}

/** Remounted when the URL's prices change, so the inputs always start from them. */
function PriceFilter({
  filters,
  onApply,
  t,
}: {
  filters: CatalogFilters
  onApply: (range: Extract<PriceRangeResult, { ok: true }>) => void
  t: StorefrontMessages
}) {
  const [min, setMin] = useState(filters.minPrice ?? "")
  const [max, setMax] = useState(filters.maxPrice ?? "")
  const [error, setError] = useState<Extract<PriceRangeResult, { ok: false }>["error"] | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const range = parsePriceRange(min, max)
    if (range.ok) {
      setError(null)
      onApply(range)
    } else {
      setError(range.error)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <FilterGroup title={t.filterPrice}>
        <div className="grid grid-cols-2 gap-2">
          <FormField label={t.minPrice} value={min} inputMode="decimal" dir="ltr" onChange={(event) => setMin(event.target.value)} />
          <FormField label={t.maxPrice} value={max} inputMode="decimal" dir="ltr" onChange={(event) => setMax(event.target.value)} />
        </div>
        {error === null ? null : (
          <p role="alert" className="type-body-small text-error-text">
            {t.priceErrors[error]}
          </p>
        )}
        <Button type="submit" variant="outline" size="sm" className="self-start">
          {t.applyPrice}
        </Button>
      </FilterGroup>
    </form>
  )
}

function ValueFilter({
  title,
  values,
  selected,
  onSelect,
}: {
  title: string
  values: readonly string[]
  selected: string | null
  onSelect: (value: string | null) => void
}) {
  const same = (value: string) => selected !== null && value.toLocaleLowerCase("und") === selected.toLocaleLowerCase("und")
  // A value from a shared link stays visible, so it can be removed.
  const shown = selected === null || values.some(same) ? values : [selected, ...values]
  if (shown.length === 0) return null
  return (
    <FilterGroup title={title}>
      <div className="flex flex-wrap gap-2">
        {shown.map((value) => (
          <Chip key={value} dir="auto" pressed={same(value)} onPressedChange={() => onSelect(same(value) ? null : value)}>
            {value}
          </Chip>
        ))}
      </div>
    </FilterGroup>
  )
}

/**
 * Filters of a listing. Sizes and colors come from the catalog, so only values
 * that exist are offered. Collapsed behind a button on small screens.
 */
export function CatalogFiltersPanel({ filters, onChange, t }: { filters: CatalogFilters; onChange: (next: CatalogFilters) => void; t: StorefrontMessages }) {
  const [open, setOpen] = useState(false)
  const { view: facets } = useCatalogRequest<CatalogFacetsResponse>(facetsApiPath(filters.category))
  const sizes = facets.state === "ready" ? facets.data.sizes : []
  const colors = facets.state === "ready" ? facets.data.colors : []
  const active = activeFilterCount(filters)

  const chooseCategory = (category: ProductCategory | null) => onChange(changeCategory(filters, category))

  return (
    <div className="flex flex-col gap-3">
      <Button variant="outline" className="self-start lg:hidden" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal aria-hidden />
        {active === 0 ? t.filters : t.filtersWithCount.replace("{count}", String(active))}
      </Button>
      <aside aria-label={t.filters} className={cn(open ? "flex" : "hidden", "flex-col gap-5 rounded-2xl border border-border bg-surface p-4 lg:flex")}>
        <FilterGroup title={t.filterCategory}>
          <div className="flex flex-wrap gap-2">
            <Chip pressed={filters.category === null} onPressedChange={() => chooseCategory(null)}>
              {t.filterAllCategories}
            </Chip>
            {PRODUCT_CATEGORIES.map((category) => (
              <Chip key={category} pressed={filters.category === category} onPressedChange={() => chooseCategory(category)}>
                {t.categories[category]}
              </Chip>
            ))}
          </div>
        </FilterGroup>
        <PriceFilter
          key={`${filters.minPrice ?? ""}|${filters.maxPrice ?? ""}`}
          filters={filters}
          t={t}
          onApply={({ minPrice, maxPrice }) => onChange(changeFilters(filters, { minPrice, maxPrice }))}
        />
        <FilterGroup title={t.filterAvailability}>
          <div>
            <Chip pressed={filters.availableOnly} onPressedChange={(availableOnly) => onChange(changeFilters(filters, { availableOnly }))}>
              {t.availableOnly}
            </Chip>
          </div>
        </FilterGroup>
        <ValueFilter title={t.filterSize} values={sizes} selected={filters.size} onSelect={(size) => onChange(changeFilters(filters, { size }))} />
        <ValueFilter title={t.filterColor} values={colors} selected={filters.color} onSelect={(color) => onChange(changeFilters(filters, { color }))} />
        {active > 0 ? (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange(clearFilters(filters))}>
            {t.clearFilters}
          </Button>
        ) : null}
      </aside>
    </div>
  )
}
