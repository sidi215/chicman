"use client"

import { PRODUCT_STATUSES, type ProductStatus, type SellerProductListResponse } from "@chicman/shared"
import { ImageIcon } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Chip } from "@/components/ui/chip"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { ModerationBadge } from "@/features/moderation/components/seller-moderation"
import { useModerationMessages } from "@/features/moderation/messages"
import { SELLER_MODERATION_FILTERS, type SellerModerationFilter } from "@/features/moderation/moderation"

import { useProductMessages } from "../messages"
import type { ProductFailure } from "../product-form"
import { STATUS_VARIANT, useProductApi } from "./product-shared"

type View = { state: "loading" } | { state: "ready"; data: SellerProductListResponse } | { state: "failed"; failure: ProductFailure }
/** A seller status, or a moderation state (spec 19: "Restreint", "En révision", "Retiré"). */
type ListFilter = { kind: "status"; value: ProductStatus } | { kind: "moderation"; value: SellerModerationFilter } | null

/** The seller's products, newest first, by status and page. */
export function ProductList({ initialModeration = null }: { initialModeration?: SellerModerationFilter | null } = {}) {
  const locale = useLocale()
  const t = useProductMessages()
  const moderationText = useModerationMessages()
  const { status, call } = useProductApi()
  const [view, setView] = useState<View>({ state: "loading" })
  const [filter, setFilter] = useState<ListFilter>(initialModeration === null ? null : { kind: "moderation", value: initialModeration })
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    const query = new URLSearchParams({ page: String(page) })
    if (filter?.kind === "status") query.set("status", filter.value)
    if (filter?.kind === "moderation") query.set("moderationStatus", filter.value)
    void call<SellerProductListResponse>(`/sellers/me/products?${query.toString()}`).then((outcome) => {
      if (cancelled) return
      setView(outcome.state === "ok" ? { state: "ready", data: outcome.data } : { state: "failed", failure: outcome.state })
    })
    return () => {
      cancelled = true
    }
  }, [status, call, filter, page, reloads])

  const choose = (next: ListFilter) => {
    setFilter(next)
    setPage(1)
    setView({ state: "loading" })
  }
  const goTo = (next: number) => {
    setPage(next)
    setView({ state: "loading" })
  }

  const pages = view.state === "ready" ? Math.max(1, Math.ceil(view.data.total / view.data.pageSize)) : 1

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page py-6">
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="type-headline-small">{t.listTitle}</h1>
            <p className="type-body-medium text-muted-foreground">{t.listSubtitle}</p>
          </div>
          {view.state === "failed" && view.failure === "forbidden" ? null : (
            <Link href="/seller/products/new" className={buttonVariants()}>
              {t.add}
            </Link>
          )}
        </div>
        <div role="group" aria-label={t.filterLabel} className="flex flex-wrap gap-2">
          <Chip pressed={filter === null} onPressedChange={() => choose(null)}>
            {t.filterAll}
          </Chip>
          {PRODUCT_STATUSES.map((value) => (
            <Chip key={value} pressed={filter?.kind === "status" && filter.value === value} onPressedChange={() => choose({ kind: "status", value })}>
              {t.status[value]}
            </Chip>
          ))}
        </div>
        <div role="group" aria-label={moderationText.seller.filterLabel} className="flex flex-wrap gap-2">
          {SELLER_MODERATION_FILTERS.map((value) => (
            <Chip key={value} pressed={filter?.kind === "moderation" && filter.value === value} onPressedChange={() => choose({ kind: "moderation", value })}>
              {moderationText.status[value]}
            </Chip>
          ))}
        </div>
        {view.state === "loading" || status !== "signed-in" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
        {view.state === "failed" ? (
          <Card className="rounded-3xl p-6">
            <CardContent className="flex flex-col gap-4">
              <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
              {view.failure === "forbidden" ? (
                <TextLink href="/seller/shop">{t.backToShop}</TextLink>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    setView({ state: "loading" })
                    setReloads((count) => count + 1)
                  }}
                >
                  {t.retry}
                </Button>
              )}
            </CardContent>
          </Card>
        ) : null}
        {view.state === "ready" && view.data.products.length === 0 ? (
          <p className="type-body-medium text-muted-foreground">{filter === null ? t.empty : t.emptyFiltered}</p>
        ) : null}
        {view.state === "ready" ? (
          <ul className="flex flex-col gap-3">
            {view.data.products.map((product) => (
              <li key={product.id}>
                <Link
                  href={`/seller/products/${product.id}`}
                  aria-label={`${t.open} : ${product.name}`}
                  className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-3 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  {product.mainImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is
                    <img src={product.mainImageUrl} alt="" className="size-20 shrink-0 rounded-2xl object-cover" />
                  ) : (
                    <span className="flex size-20 shrink-0 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                      <ImageIcon aria-hidden className="size-icon-navigation" />
                    </span>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate type-title-small">{product.name}</span>
                    <span className="type-body-medium">{formatMru(product.price, locale)}</span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={STATUS_VARIANT[product.status]}>{t.status[product.status]}</Badge>
                      <ModerationBadge status={product.moderation.status} />
                      <Badge variant={product.available ? "outline" : "destructive"}>{product.available ? t.available : t.unavailable}</Badge>
                      <span className="type-body-small text-muted-foreground">
                        {t.stockLabel} : {product.stock}
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {view.state === "ready" && pages > 1 ? (
          <nav className="flex items-center justify-between gap-3">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goTo(page - 1)}>
              {t.previousPage}
            </Button>
            <span className="type-body-small text-muted-foreground">{t.pageOf.replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
            <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => goTo(page + 1)}>
              {t.nextPage}
            </Button>
          </nav>
        ) : null}
      </div>
      <TextLink href="/seller/shop">{t.backToShop}</TextLink>
    </main>
  )
}
