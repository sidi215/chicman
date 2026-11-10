"use client"

import type { SellerPaymentSummary } from "@chicman/shared"
import { useEffect, useState, type FormEvent } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Button } from "@/components/ui/button"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import type { Locale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { useOrderMessages, type OrderMessages } from "../messages"
import { defaultSummaryPeriod, paymentSummaryPath, summaryPeriodError, type OrderFailure, type SummaryPeriod, type SummaryPeriodError } from "../order-logic"
import { useOrderApi } from "./order-shared"

/** A UTC day (`YYYY-MM-DD`) in the UI locale. */
function formatDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-MR" : "fr-FR", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`))
}

function Figure({ title, count, total, t }: { title: string; count: number; total?: string; t: OrderMessages }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-muted p-4">
      <p className="type-label-large text-muted-foreground">{title}</p>
      {total === undefined ? null : <p className="type-title-large">{total}</p>}
      <p className="type-body-medium">{t.summaryCount.replace("{count}", String(count))}</p>
    </div>
  )
}

type View = { state: "loading" } | { state: "ready"; data: SellerPaymentSummary } | { state: "failed"; failure: OrderFailure }

/**
 * `/seller/payments` (spec 13, section 9; web only: O1): the seller's
 * cash-on-delivery payments for the shop orders placed in a period, by
 * status, as the API counts them. No ledger, settlement, or payout.
 */
export function SellerPaymentSummaryPage() {
  const t = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useOrderApi()
  const [draft, setDraft] = useState<SummaryPeriod>(() => defaultSummaryPeriod())
  const [period, setPeriod] = useState<SummaryPeriod>(draft)
  const [periodError, setPeriodError] = useState<SummaryPeriodError | null>(null)
  const [view, setView] = useState<View>({ state: "loading" })
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<SellerPaymentSummary>(paymentSummaryPath(period)).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      setView(outcome.state === "ok" ? { state: "ready", data: outcome.data } : { state: "failed", failure: outcome.failure })
    })
    return () => {
      cancelled = true
    }
  }, [status, call, period, reloads])

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = summaryPeriodError(draft)
    setPeriodError(error)
    if (error !== null) return
    setView({ state: "loading" })
    setPeriod({ ...draft })
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-small">{t.summaryTitle}</h1>
          <p className="type-body-medium text-muted-foreground">{t.summarySubtitle}</p>
        </div>
        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:flex-row sm:items-end sm:p-6">
          <div className="flex-1">
            <FormField label={t.summaryFrom} type="date" value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} />
          </div>
          <div className="flex-1">
            <FormField label={t.summaryTo} type="date" value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} />
          </div>
          <Button type="submit" disabled={view.state === "loading"}>
            {t.summaryShow}
          </Button>
        </form>
        {periodError === null ? null : <FormMessage tone="error">{t.summaryErrors[periodError]}</FormMessage>}
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
        {view.state === "ready" ? (
          <section className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
            <p className="type-body-medium text-muted-foreground">
              {t.summaryPeriod.replace("{from}", formatDay(view.data.from, locale)).replace("{to}", formatDay(view.data.to, locale))}
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Figure title={t.summaryCollected} count={view.data.collected.count} total={formatMru(view.data.collected.total, locale)} t={t} />
              <Figure title={t.summaryPending} count={view.data.pending.count} total={formatMru(view.data.pending.total, locale)} t={t} />
              <Figure title={t.summaryFailed} count={view.data.failed.count} t={t} />
              <Figure title={t.summaryCancelled} count={view.data.cancelled.count} t={t} />
            </div>
          </section>
        ) : null}
        <TextLink href="/seller/orders">{t.backToShopOrders}</TextLink>
      </div>
    </main>
  )
}
