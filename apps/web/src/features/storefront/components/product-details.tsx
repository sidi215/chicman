"use client"

import type { PublicProductDetail } from "@chicman/shared"
import { Store } from "lucide-react"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { TextLink } from "@/features/auth/components/text-link"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"
import { cn } from "@/lib/utils"

import { listingHref, NO_FILTERS } from "../catalog-query"
import { useStorefrontMessages, type StorefrontMessages } from "../messages"
import { colorOptions, isChosen, NO_CHOICE, selectVariant, sizeOptions, toggleChoice, type VariantChoice, type VariantOption } from "../variant-selection"

function Gallery({ product, t }: { product: PublicProductDetail; t: StorefrontMessages }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = product.images.find((image) => image.id === selectedId) ?? product.images[0]
  const position = selected === undefined ? 1 : product.images.indexOf(selected) + 1
  return (
    <section aria-label={t.gallery} className="flex flex-col gap-3">
      <div className="aspect-[3/4] overflow-hidden rounded-3xl bg-muted">
        {selected === undefined ? null : (
          // eslint-disable-next-line @next/next/no-img-element -- verified media URL, already normalized by the server
          <img src={selected.url} alt={t.productImage.replace("{number}", String(position)).replace("{name}", product.name)} className="size-full object-cover" />
        )}
      </div>
      {product.images.length > 1 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {product.images.map((image, index) => (
            <li key={image.id} className="shrink-0">
              <button
                type="button"
                aria-label={t.showImage.replace("{number}", String(index + 1))}
                aria-current={image === selected ? "true" : undefined}
                onClick={() => setSelectedId(image.id)}
                className={cn(
                  "block size-16 overflow-hidden rounded-2xl border-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  image === selected ? "border-foreground" : "border-transparent"
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- verified media URL */}
                <img src={image.url} alt="" loading="lazy" className="size-full object-cover" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function OptionGroup({
  title,
  options,
  chosen,
  onToggle,
  t,
}: {
  title: string
  options: readonly VariantOption[]
  chosen: string | null
  onToggle: (value: string) => void
  t: StorefrontMessages
}) {
  if (options.length === 0) return null
  const current = options.find(({ value }) => isChosen(chosen, value))
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 type-label-large">
        {title}
        {current === undefined ? null : <span className="font-normal"> : {current.value}</span>}
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map(({ value, available }) => (
          <Chip
            key={value}
            dir="auto"
            pressed={isChosen(chosen, value)}
            aria-label={available ? value : t.optionUnavailable.replace("{value}", value)}
            onPressedChange={() => onToggle(value)}
            className={available ? undefined : "line-through opacity-60"}
          >
            {value}
          </Chip>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * Size and color choice. Unavailable values remain visible and selectable, so
 * customers can see what exists; the page offers no purchase action here. The
 * cart and checkout (specs 09 and 10) enforce availability on the server.
 */
function VariantPicker({ product, t }: { product: PublicProductDetail; t: StorefrontMessages }) {
  const [choice, setChoice] = useState<VariantChoice>(NO_CHOICE)
  const selection = selectVariant(product.variants, choice)
  const toggle = (attribute: keyof VariantChoice, value: string) => setChoice((current) => toggleChoice(current, attribute, value))
  return (
    <div className="flex flex-col gap-4">
      <OptionGroup title={t.filterSize} options={sizeOptions(product.variants, choice)} chosen={choice.size} onToggle={(value) => toggle("size", value)} t={t} />
      <OptionGroup title={t.filterColor} options={colorOptions(product.variants, choice)} chosen={choice.color} onToggle={(value) => toggle("color", value)} t={t} />
      <p role="status" className="type-body-medium">
        {selection.state === "incomplete" ? <span className="text-muted-foreground">{t.chooseOptions}</span> : null}
        {selection.state === "no-match" ? <span className="text-error-text">{t.noSuchCombination}</span> : null}
        {selection.state === "selected" && selection.variant.available ? <span className="text-success-text">{t.variantAvailable}</span> : null}
        {selection.state === "selected" && !selection.variant.available ? <span className="text-error-text">{t.variantUnavailable}</span> : null}
      </p>
    </div>
  )
}

function ShopInfo({ shop, t }: { shop: PublicProductDetail["shop"]; t: StorefrontMessages }) {
  return (
    <section aria-label={t.soldBy} className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4">
      {shop.logoUrl === null ? (
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Store aria-hidden className="size-icon-action" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- verified media URL
        <img src={shop.logoUrl} alt="" loading="lazy" className="size-12 shrink-0 rounded-full object-cover" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="type-body-small text-muted-foreground">{t.soldBy}</p>
        <p dir="auto" className="type-title-small">
          {shop.name}
        </p>
        <p dir="auto" className="type-body-small text-muted-foreground">
          {t.city} : {shop.city}
        </p>
        <p dir="auto" className="type-body-medium whitespace-pre-line">
          {shop.description}
        </p>
      </div>
    </section>
  )
}

function ProductContent({ product, t }: { product: PublicProductDetail; t: StorefrontMessages }) {
  const locale = useLocale()
  return (
    <div className="grid gap-6 md:grid-cols-2 md:items-start">
      <Gallery product={product} t={t} />
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Link href={localizedPath(locale, listingHref({ ...NO_FILTERS, category: product.category }))} className="type-label-medium text-muted-foreground hover:underline">
            {t.categories[product.category]}
          </Link>
          <h1 dir="auto" className="type-headline-large">
            {product.name}
          </h1>
          {product.brand === null ? null : (
            <p className="type-body-medium text-muted-foreground">
              {t.brandLabel} : <span dir="auto">{product.brand}</span>
            </p>
          )}
          <p className="type-headline-medium">{formatMru(product.price, locale)}</p>
          <div>
            <Badge variant={product.available ? "success" : "destructive"}>{product.available ? t.available : t.unavailable}</Badge>
          </div>
          {product.available ? null : <p className="type-body-medium text-error-text">{t.productUnavailable}</p>}
        </div>
        {product.variants.length > 0 ? <VariantPicker product={product} t={t} /> : null}
        <section className="flex flex-col gap-2">
          <h2 className="type-title-medium">{t.description}</h2>
          {/* Shown in the language the seller wrote it in. */}
          <p dir="auto" className="type-body-medium whitespace-pre-line">
            {product.description}
          </p>
        </section>
        <ShopInfo shop={product.shop} t={t} />
      </div>
    </div>
  )
}

/** The page's frame: the link back to the products, around its content. */
export function ProductPageFrame({ children }: { children: ReactNode }) {
  const t = useStorefrontMessages()
  const locale = useLocale()
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <TextLink href={localizedPath(locale, listingHref(NO_FILTERS))}>{t.backToProducts}</TextLink>
      {children}
    </main>
  )
}

export function ProductDetails({ product }: { product: PublicProductDetail }) {
  const t = useStorefrontMessages()
  return <ProductContent key={product.id} product={product} t={t} />
}

export function ProductNotFound() {
  const t = useStorefrontMessages()
  const locale = useLocale()
  return (
    <div className="flex flex-col items-start gap-3">
      <h1 className="type-headline-medium">{t.notFoundTitle}</h1>
      <p className="type-body-medium text-muted-foreground">{t.notFoundBody}</p>
      <Link href={localizedPath(locale, listingHref(NO_FILTERS))} className={buttonVariants({ variant: "outline" })}>
        {t.allProducts}
      </Link>
    </div>
  )
}
