"use client"

import type { SellerDelivery, SellerInProgressDeliveriesResponse } from "@chicman/shared"
import { MapPin } from "lucide-react"
import { useEffect, useState } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Button } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { useOrderMessages, type OrderMessages } from "../messages"
import { IN_PROGRESS_DELIVERIES_PATH, type OrderFailure } from "../order-logic"
import { DeliveryPanel } from "./delivery-panel"
import { AmountRow, feeText, ItemList, LabelBadge, useOrderApi } from "./order-shared"

/** The full delivery snapshot (D11): the seller needs it to finish the delivery. */
function Destination({ delivery, t }: { delivery: SellerDelivery["delivery"]; t: OrderMessages }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="flex items-center gap-2 type-title-small">
        <MapPin aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
        {t.deliverTo}
      </p>
      <p dir="auto" className="type-body-medium">{`${delivery.district}, ${delivery.city}`}</p>
      <p className="type-body-medium">
        {t.recipient} : <span dir="auto">{delivery.recipientName}</span>
      </p>
      <p className="type-body-medium">
        {t.deliveryPhone} : <span dir="ltr">{delivery.deliveryPhone}</span>
      </p>
      <p className="type-body-small text-muted-foreground">
        {t.landmark} : <span dir="auto">{delivery.landmark}</span>
      </p>
      <a
        className="type-body-small underline"
        target="_blank"
        rel="noopener noreferrer"
        href={`https://www.openstreetmap.org/?mlat=${delivery.latitude}&mlon=${delivery.longitude}#map=17/${delivery.latitude}/${delivery.longitude}`}
      >
        {t.openMap}
      </a>
    </div>
  )
}

type View = { state: "loading" } | { state: "ready"; data: SellerInProgressDeliveriesResponse } | { state: "failed"; failure: OrderFailure }

/**
 * `/seller/deliveries` (spec 12, D8): the deliveries out for delivery, or
 * failed and not closed. For an approved shop, a shortcut; for a suspended
 * shop, the only orders its owner can see and finish.
 */
export function SellerInProgressDeliveries() {
  const t = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useOrderApi()
  const [view, setView] = useState<View>({ state: "loading" })
  const [reloads, setReloads] = useState(0)
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<SellerInProgressDeliveriesResponse>(IN_PROGRESS_DELIVERIES_PATH).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      setView(outcome.state === "ok" ? { state: "ready", data: outcome.data } : { state: "failed", failure: outcome.failure })
    })
    return () => {
      cancelled = true
    }
  }, [status, call, reloads])

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-small">{t.inProgressTitle}</h1>
          <p className="type-body-medium text-muted-foreground">{t.inProgressSubtitle}</p>
        </div>
        {notice === null ? null : <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}
        {view.state === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
        {view.state === "failed" ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
            {view.failure === "forbidden" ? null : (
              <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
                {t.retry}
              </Button>
            )}
          </div>
        ) : null}
        {view.state === "ready" && view.data.deliveries.length === 0 ? <p className="type-body-medium text-muted-foreground">{t.noInProgress}</p> : null}
        {view.state === "ready"
          ? view.data.deliveries.map((delivery) => (
              <article key={delivery.shopOrderId} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="type-title-medium">
                    {t.reference} : <span dir="ltr">{delivery.orderReference}</span>
                  </p>
                  <LabelBadge label={delivery.label} t={t} />
                </div>
                <Destination delivery={delivery.delivery} t={t} />
                <ItemList items={delivery.items} t={t} />
                <div className="flex flex-col gap-1 border-t border-border pt-3">
                  <AmountRow label={t.productsSubtotal} value={formatMru(delivery.productsSubtotal, locale)} />
                  <AmountRow label={t.deliveryFee} value={feeText(delivery.deliveryFee, t, locale)} />
                  <AmountRow label={t.amountDue} value={formatMru(delivery.payment.amountDue, locale)} strong />
                </div>
                <DeliveryPanel
                  shopOrderId={delivery.shopOrderId}
                  record={delivery.record}
                  amountDue={delivery.payment.amountDue}
                  t={t}
                  call={call}
                  onChanged={(next) => {
                    setNotice(next)
                    setReloads((count) => count + 1)
                  }}
                />
              </article>
            ))
          : null}
        <TextLink href="/seller/shop">{t.backToShop}</TextLink>
      </div>
    </main>
  )
}
