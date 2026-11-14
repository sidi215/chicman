"use client"

import type {
  OwnerShopResponse,
  SellerInProgressDeliveriesResponse,
  SellerPaymentSummary,
  SellerProductListResponse,
  SellerShopOrderListResponse,
  ShopStatus,
} from "@chicman/shared"
import Link from "next/link"
import { useEffect, useState, type ComponentProps } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"
import { useNotifications } from "@/features/notifications/notifications-provider"
import { InProgressDeliveryList } from "@/features/orders/components/seller-deliveries"
import { useOrderApi } from "@/features/orders/components/order-shared"
import { defaultSummaryPeriod, IN_PROGRESS_DELIVERIES_PATH, paymentSummaryPath } from "@/features/orders/order-logic"
import { useShopMessages } from "@/features/shop/messages"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"
import { cn } from "@/lib/utils"

import { useSellerMessages, type SellerMessages } from "../messages"
import { needsDeliveryFee, SELLER_AREA_HREF, sellerOrderCountPath, sellerProductCountPath } from "../seller-dashboard"
import { useSellerShop } from "../seller-shop-provider"

const STATUS_VARIANT: Record<ShopStatus, ComponentProps<typeof Badge>["variant"]> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
  SUSPENDED: "destructive",
}

/** `undefined` while loading, `null` when the read failed. */
type Figure<T> = T | null | undefined

interface Summary {
  pendingOrders: Figure<number>
  confirmedOrders: Figure<number>
  inProgressDeliveries: Figure<number>
  publishedProducts: Figure<number>
  draftProducts: Figure<number>
  payments: Figure<SellerPaymentSummary>
}

const LOADING: Summary = {
  pendingOrders: undefined,
  confirmedOrders: undefined,
  inProgressDeliveries: undefined,
  publishedProducts: undefined,
  draftProducts: undefined,
  payments: undefined,
}

/**
 * Reads the approved shop's figures from the existing feature APIs (specs 07,
 * 11, 12, 13), each on its own, so one failure leaves the others shown. The
 * API counts; nothing is worked out here. A refusal means the status changed
 * meanwhile: the shell reads the shop again.
 */
function useApprovedSummary(): { summary: Summary; retry: () => void } {
  const { status, call } = useOrderApi()
  const { refresh } = useSellerShop()
  const [summary, setSummary] = useState<Summary>(LOADING)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    function read<T, K extends keyof Summary>(key: K, path: string, pick: (data: T) => NonNullable<Summary[K]>) {
      void call<T>(path).then((outcome) => {
        if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
        if (outcome.state === "failed" && outcome.failure === "forbidden") void refresh()
        setSummary((current) => ({ ...current, [key]: outcome.state === "ok" ? pick(outcome.data) : null }))
      })
    }
    read<SellerShopOrderListResponse, "pendingOrders">("pendingOrders", sellerOrderCountPath("PENDING"), (data) => data.total)
    read<SellerShopOrderListResponse, "confirmedOrders">("confirmedOrders", sellerOrderCountPath("CONFIRMED"), (data) => data.total)
    read<SellerInProgressDeliveriesResponse, "inProgressDeliveries">("inProgressDeliveries", IN_PROGRESS_DELIVERIES_PATH, (data) => data.deliveries.length)
    read<SellerProductListResponse, "publishedProducts">("publishedProducts", sellerProductCountPath("PUBLISHED"), (data) => data.total)
    read<SellerProductListResponse, "draftProducts">("draftProducts", sellerProductCountPath("DRAFT"), (data) => data.total)
    read<SellerPaymentSummary, "payments">("payments", paymentSummaryPath(defaultSummaryPeriod()), (data) => data)
    return () => {
      cancelled = true
    }
  }, [status, call, refresh, reloads])

  return {
    summary,
    retry: () => {
      setSummary(LOADING)
      setReloads((count) => count + 1)
    },
  }
}

function Tile({ title, value, detail, href, t }: { title: string; value: string | undefined | null; detail?: string | undefined; href: string; t: SellerMessages }) {
  return (
    <Link
      href={href}
      aria-busy={value === undefined || undefined}
      className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="type-label-large text-muted-foreground">{title}</span>
      {value === undefined ? (
        <span aria-hidden className="h-8 w-16 animate-pulse rounded-full bg-muted" />
      ) : (
        <span className="type-headline-small" dir="auto">
          {value ?? t.unknown}
        </span>
      )}
      {detail === undefined ? null : <span className="type-body-small text-muted-foreground">{detail}</span>}
    </Link>
  )
}

const countText = (figure: Figure<number>): string | null | undefined => (figure === undefined || figure === null ? figure : String(figure))

function ApprovedSummary({ shop, t }: { shop: OwnerShopResponse; t: SellerMessages }) {
  const locale = useLocale()
  const shopT = useShopMessages()
  const { unread } = useNotifications()
  const { summary, retry } = useApprovedSummary()
  const failed = Object.values(summary).some((figure) => figure === null)
  const payments = summary.payments
  const noProducts = summary.publishedProducts === 0 && summary.draftProducts === 0

  return (
    <>
      {needsDeliveryFee(shop) ? (
        <section role="status" className="flex flex-col items-start gap-3 rounded-2xl bg-warning/15 p-4">
          <p className="type-body-medium text-warning-text">{shopT.deliveryFeeMissing}</p>
          <Link href={SELLER_AREA_HREF.shop} className={buttonVariants({ size: "sm" })}>
            {t.deliveryFeeAction}
          </Link>
        </section>
      ) : null}
      <section aria-labelledby="seller-summary" className="flex flex-col gap-3">
        <h2 id="seller-summary" className="type-title-large">
          {t.summaryTitle}
        </h2>
        {failed ? (
          <div className="flex flex-wrap items-center gap-3">
            <FormMessage tone="error">{t.summaryFailed}</FormMessage>
            <Button variant="outline" size="sm" onClick={retry}>
              {t.retry}
            </Button>
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Tile title={t.tiles.pendingOrders} value={countText(summary.pendingOrders)} href={SELLER_AREA_HREF.orders} t={t} />
          <Tile title={t.tiles.confirmedOrders} value={countText(summary.confirmedOrders)} href={SELLER_AREA_HREF.orders} t={t} />
          <Tile title={t.tiles.inProgressDeliveries} value={countText(summary.inProgressDeliveries)} href={SELLER_AREA_HREF.deliveries} t={t} />
          <Tile title={t.tiles.unread} value={String(unread)} href={SELLER_AREA_HREF.notifications} t={t} />
          <Tile title={t.tiles.publishedProducts} value={countText(summary.publishedProducts)} href={SELLER_AREA_HREF.products} t={t} />
          <Tile title={t.tiles.draftProducts} value={countText(summary.draftProducts)} href={SELLER_AREA_HREF.products} t={t} />
          <Tile
            title={t.tiles.toCollect}
            value={payments === undefined || payments === null ? payments : formatMru(payments.pending.total, locale)}
            detail={payments ? t.tileCount.replace("{count}", String(payments.pending.count)) : undefined}
            href={SELLER_AREA_HREF.payments}
            t={t}
          />
          <Tile
            title={t.tiles.collected}
            value={payments === undefined || payments === null ? payments : formatMru(payments.collected.total, locale)}
            detail={payments ? t.tileCount.replace("{count}", String(payments.collected.count)) : undefined}
            href={SELLER_AREA_HREF.payments}
            t={t}
          />
        </div>
      </section>
      {noProducts ? (
        <section className="flex flex-col items-start gap-2 rounded-3xl border border-dashed border-border bg-surface p-6">
          <h2 className="type-title-medium">{t.noProductsTitle}</h2>
          <p className="type-body-medium text-muted-foreground">{t.noProductsBody}</p>
          <Link href={`${SELLER_AREA_HREF.products}/new`} className={buttonVariants()}>
            {t.addProduct}
          </Link>
        </section>
      ) : null}
    </>
  )
}

/** Name and status. Never an administrative reason: the shop page shows what the applicant may read (spec 06). */
function StatusHeader({ shop, t }: { shop: OwnerShopResponse; t: SellerMessages }) {
  const shopT = useShopMessages()
  return (
    <section className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {shop.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- verified media URL, served as-is
          <img src={shop.logoUrl} alt="" className="size-12 rounded-2xl border border-border object-cover" />
        ) : null}
        <p className="type-title-medium" dir="auto">
          {shop.shopName}
        </p>
        <Badge variant={STATUS_VARIANT[shop.status]}>{shopT.status[shop.status]}</Badge>
      </div>
      <p className="type-body-medium text-muted-foreground">{shopT.statusHelp[shop.status]}</p>
      {shop.status === "SUSPENDED" ? <p className="type-body-medium">{shopT.suspendedNotice}</p> : null}
      <Link href={SELLER_AREA_HREF.shop} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
        {shop.status === "PENDING" || shop.status === "REJECTED" ? t.viewApplication : t.manageShop}
      </Link>
    </section>
  )
}

/**
 * `/seller` (spec 16): the dashboard's overview for the shop's status. An
 * approved shop sees its figures and, without a delivery fee, the prompt to
 * set one (D2); applicants see their status; a suspended shop sees only its
 * deliveries to finish (D8), when there are any.
 */
export function SellerOverview() {
  const t = useSellerMessages()
  // The shell's provider reads the shop again on each page change, so the status and fee are current.
  const { shop, refresh } = useSellerShop()

  return (
    <main className="flex w-full flex-1 flex-col gap-6 py-6">
      <h1 className="type-headline-small">{t.title}</h1>
      {shop.state === "unavailable" || shop.state === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage tone="error">{shop.state === "unavailable" ? t.unavailable : t.generic}</FormMessage>
          <Button variant="outline" onClick={() => void refresh()}>
            {t.retry}
          </Button>
        </div>
      ) : null}
      {shop.state === "no-shop" ? (
        <section className="flex flex-col items-start gap-3 rounded-3xl border border-border bg-surface p-6">
          <h2 className="type-title-large">{t.applyTitle}</h2>
          <p className="type-body-medium text-muted-foreground">{t.applyBody}</p>
          <Link href={SELLER_AREA_HREF.shop} className={buttonVariants()}>
            {t.applyAction}
          </Link>
        </section>
      ) : null}
      {shop.state === "shop" ? (
        <>
          <StatusHeader shop={shop.shop} t={t} />
          {shop.shop.status === "APPROVED" ? <ApprovedSummary shop={shop.shop} t={t} /> : null}
          {shop.shop.status === "SUSPENDED" ? (
            <InProgressDeliveryList hideWhenEmpty title={<h2 className="type-title-large">{t.suspendedDeliveriesTitle}</h2>} />
          ) : null}
        </>
      ) : null}
    </main>
  )
}
