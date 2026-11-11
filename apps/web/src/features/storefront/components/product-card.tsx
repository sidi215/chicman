"use client"

import type { PublicProductSummary } from "@chicman/shared"
import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { FavoriteButton } from "@/features/favorites/components/favorite-button"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import type { StorefrontMessages } from "../messages"

/**
 * The storefront's product card: main image, name, price, shop, availability
 * when relevant, and the favorite heart. The heart sits beside the link, not
 * inside it, so it stays its own control.
 */
export function ProductCard({ product, t }: { product: PublicProductSummary; t: StorefrontMessages }) {
  const locale = useLocale()
  return (
    <div className="relative h-full">
      <Link
        href={localizedPath(locale, `/products/${product.id}`)}
        className="group flex h-full flex-col overflow-hidden rounded-3xl border border-border bg-surface transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="relative block aspect-[3/4] overflow-hidden bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- verified media URL, already normalized by the server */}
          <img src={product.mainImageUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
          {product.available ? null : (
            <Badge variant="destructive" className="absolute start-2 top-2 bg-surface">
              {t.unavailable}
            </Badge>
          )}
        </span>
        <span className="flex flex-1 flex-col gap-1 p-3">
          {/* Seller content keeps its own language and direction. */}
          <span dir="auto" className="line-clamp-2 type-title-small">
            {product.name}
          </span>
          <span className="type-body-medium font-semibold">{formatMru(product.price, locale)}</span>
          <span dir="auto" className="truncate type-body-small text-muted-foreground">
            {product.shop.name}
          </span>
        </span>
      </Link>
      {/*
        The heart cannot sit inside the link, so this layer covers exactly the image
        (inside the card's 1px border, same 3:4 ratio) and is its positioning reference.
        It lets clicks through everywhere except the heart.
      */}
      <span className="pointer-events-none absolute inset-x-px top-px aspect-[3/4]">
        <FavoriteButton productId={product.id} name={product.name} className="pointer-events-auto absolute end-2 top-2 z-10" />
      </span>
    </div>
  )
}

/** Two columns on phones, more on larger screens. */
export function ProductGrid({ products, t }: { products: readonly PublicProductSummary[]; t: StorefrontMessages }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
      {products.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} t={t} />
        </li>
      ))}
    </ul>
  )
}

export function ProductGridSkeleton({ count, label }: { count: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="aspect-[3/4] animate-pulse rounded-3xl bg-muted" />
      ))}
    </div>
  )
}
