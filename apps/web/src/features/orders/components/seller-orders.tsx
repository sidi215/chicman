"use client"

import {
  SELLER_CANCELLATION_REASONS,
  SELLER_REJECTION_REASONS,
  SHOP_ORDER_STATUSES,
  type SellerCancellationReason,
  type SellerShopOrderDetail,
  type SellerShopOrderListResponse,
  type ShopOrderStatus,
} from "@chicman/shared"
import { MapPin } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { formatDateTime } from "@/lib/date-time"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { useOrderMessages, type OrderMessages } from "../messages"
import {
  listQuery,
  needsReload,
  pageCount,
  SELLER_ORDERS_PATH,
  sellerActionPath,
  sellerCancellationBody,
  sellerDecisionText,
  SELLER_DELIVERIES_HREF,
  SELLER_PAYMENTS_HREF,
  sellerOrderHref,
  sellerRejectionBody,
  sellerShopOrderPath,
  showsDeadline,
  type OrderFailure,
} from "../order-logic"
import { DeliveryPanel } from "./delivery-panel"
import { AmountRow, DecisionLine, feeText, ItemList, LabelBadge, Pagination, useOrderApi } from "./order-shared"

type ListView = { state: "loading" } | { state: "ready"; data: SellerShopOrderListResponse } | { state: "failed"; failure: OrderFailure }

/** `/seller/orders`: the shop's orders, newest first, by status. Only the delivery area is listed. */
export function SellerOrderList() {
  const t = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useOrderApi()
  const [view, setView] = useState<ListView>({ state: "loading" })
  const [filter, setFilter] = useState<ShopOrderStatus | null>(null)
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<SellerShopOrderListResponse>(`${SELLER_ORDERS_PATH}${listQuery(page, filter)}`).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      setView(outcome.state === "ok" ? { state: "ready", data: outcome.data } : { state: "failed", failure: outcome.failure })
    })
    return () => {
      cancelled = true
      setView({ state: "loading" })
    }
  }, [status, call, filter, page, reloads])

  const choose = (next: ShopOrderStatus | null) => {
    setFilter(next)
    setPage(1)
  }

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-small">{t.shopOrders}</h1>
          <p className="type-body-medium text-muted-foreground">{t.shopOrdersSubtitle}</p>
        </div>
        <div role="group" aria-label={t.filterLabel} className="flex flex-wrap gap-2">
          <Chip pressed={filter === null} onPressedChange={() => choose(null)}>
            {t.filterAll}
          </Chip>
          {SHOP_ORDER_STATUSES.map((value) => (
            <Chip key={value} pressed={filter === value} onPressedChange={() => choose(value)}>
              {t.statusFilter[value]}
            </Chip>
          ))}
        </div>
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
        {view.state === "ready" && view.data.shopOrders.length === 0 ? (
          <p className="type-body-medium text-muted-foreground">{filter === null ? t.noShopOrders : t.noShopOrdersFiltered}</p>
        ) : null}
        {view.state === "ready" ? (
          <ul className="flex flex-col gap-3">
            {view.data.shopOrders.map((shopOrder) => (
              <li key={shopOrder.id}>
                <Link
                  href={sellerOrderHref(shopOrder.id)}
                  aria-label={`${t.openOrder} ${shopOrder.orderReference}`}
                  className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="type-title-small" dir="ltr">
                      {shopOrder.orderReference}
                    </span>
                    <LabelBadge label={shopOrder.label} t={t} />
                  </span>
                  <span className="type-body-small text-muted-foreground">
                    {t.placedOn.replace("{date}", formatDateTime(shopOrder.createdAt, locale))} · {t.items.replace("{count}", String(shopOrder.itemsCount))} ·{" "}
                    {formatMru(shopOrder.total, locale)}
                  </span>
                  <span dir="auto" className="type-body-small">{`${shopOrder.district}, ${shopOrder.city}`}</span>
                  {showsDeadline(shopOrder.status) ? (
                    <span className="type-body-small text-warning-text">{t.deadline.replace("{date}", formatDateTime(shopOrder.respondBy, locale))}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {view.state === "ready" ? <Pagination page={page} pages={pageCount(view.data.total, view.data.pageSize)} onPage={setPage} t={t} /> : null}
      </div>
      <TextLink href={SELLER_DELIVERIES_HREF}>{t.inProgressLink}</TextLink>
      <TextLink href={SELLER_PAYMENTS_HREF}>{t.paymentsLink}</TextLink>
      <TextLink href="/seller/shop">{t.backToShop}</TextLink>
    </main>
  )
}

/** The delivery details the seller may see at this stage (D11). */
function DeliverySection({ order, t }: { order: SellerShopOrderDetail; t: OrderMessages }) {
  const { delivery } = order
  return (
    <section className="flex flex-col gap-2 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-2 type-title-medium">
        <MapPin aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
        {delivery.stage === "FULL" ? t.deliverTo : t.area}
      </h2>
      <p dir="auto" className="type-body-medium">{`${delivery.district}, ${delivery.city}`}</p>
      {delivery.stage === "LIMITED" ? (
        <p className="type-body-small text-muted-foreground">{t.areaOnlyHint}</p>
      ) : (
        <>
          <p className="type-body-medium">
            {t.recipient} : <span dir="auto">{delivery.recipientName}</span>
          </p>
          <p className="type-body-medium">
            {t.deliveryPhone} : <span dir="ltr">{delivery.deliveryPhone}</span>
          </p>
          <p className="type-body-small text-muted-foreground">
            {t.landmark} : <span dir="auto">{delivery.landmark}</span>
          </p>
          <p className="type-body-small text-muted-foreground">
            {t.location} : <span dir="ltr">{`${delivery.latitude.toFixed(6)}, ${delivery.longitude.toFixed(6)}`}</span>
            {delivery.accuracyMeters === null ? null : ` (${t.accuracy.replace("{meters}", String(delivery.accuracyMeters))})`}
          </p>
          <a
            className="type-body-small underline"
            target="_blank"
            rel="noopener noreferrer"
            href={`https://www.openstreetmap.org/?mlat=${delivery.latitude}&mlon=${delivery.longitude}#map=17/${delivery.latitude}/${delivery.longitude}`}
          >
            {t.openMap}
          </a>
        </>
      )}
    </section>
  )
}

type Decision = { kind: "reject" } | { kind: "cancel" } | null

function ReasonForm<R extends string>({
  title,
  hint,
  reasons,
  submitLabel,
  pending,
  t,
  onSubmit,
  onClose,
}: {
  title: string
  hint: string
  reasons: readonly R[]
  submitLabel: string
  pending: boolean
  t: OrderMessages
  onSubmit: (reason: R) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState<R | null>(null)
  const [missing, setMissing] = useState(false)
  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (reason === null) return setMissing(true)
        onSubmit(reason)
      }}
    >
      <p className="type-title-small">{title}</p>
      <p className="type-body-small text-muted-foreground">{hint}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 type-label-large">{t.reasonLabel}</legend>
        <div className="flex flex-wrap gap-2">
          {reasons.map((value) => (
            <Chip
              key={value}
              pressed={reason === value}
              onPressedChange={() => {
                setReason(value)
                setMissing(false)
              }}
            >
              {t.reasons[value as SellerCancellationReason]}
            </Chip>
          ))}
        </div>
        {missing ? <p className="type-body-small text-error-text">{t.chooseReason}</p> : null}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t.sending : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          {t.back}
        </Button>
      </div>
    </form>
  )
}

type DetailView = { state: "loading" } | { state: "ready"; order: SellerShopOrderDetail } | { state: "failed"; failure: OrderFailure }

/** `/seller/orders/[shopOrderId]`: the whole shop order, accepted or refused at once (O3), with staged details. */
export function SellerOrderDetail({ shopOrderId }: { shopOrderId: string }) {
  const t = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useOrderApi()
  const [view, setView] = useState<DetailView>({ state: "loading" })
  const [reloads, setReloads] = useState(0)
  const [decision, setDecision] = useState<Decision>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<SellerShopOrderDetail>(sellerShopOrderPath(shopOrderId)).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      setView(outcome.state === "ok" ? { state: "ready", order: outcome.data } : { state: "failed", failure: outcome.failure })
    })
    return () => {
      cancelled = true
      setView({ state: "loading" })
      setDecision(null)
    }
  }, [status, call, shopOrderId, reloads])

  async function act(action: "confirm" | "reject" | "cancel", body: object, success: string) {
    setPending(true)
    setNotice(null)
    const outcome = await call<SellerShopOrderDetail>(sellerActionPath(shopOrderId, action), "POST", body)
    setPending(false)
    if (outcome.state === "stale" || outcome.state === "signed-out") return
    if (outcome.state === "ok") {
      setView({ state: "ready", order: outcome.data })
      setDecision(null)
      setNotice({ tone: "info", text: success })
      return
    }
    setNotice({ tone: "error", text: t.failures[outcome.failure] })
    if (needsReload(outcome.failure)) setReloads((count) => count + 1)
  }

  const order = view.state === "ready" ? view.order : null

  return (
    <main className="flex flex-1 flex-col items-center gap-6 bg-page px-4 py-10">
      <BrandLogo label={t.brand} />
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-col gap-1">
            <h1 className="type-headline-small">{t.shopOrders}</h1>
            {order === null ? null : (
              <p className="type-body-medium text-muted-foreground">
                {t.reference} : <span dir="ltr">{order.orderReference}</span> · {t.placedOn.replace("{date}", formatDateTime(order.createdAt, locale))}
              </p>
            )}
          </div>
          {order === null ? null : <LabelBadge label={order.label} t={t} />}
        </div>
        {notice === null ? null : <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}
        {view.state === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
        {view.state === "failed" ? (
          <div className="flex flex-col items-start gap-3">
            <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
            {view.failure === "not-found" || view.failure === "forbidden" ? null : (
              <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
                {t.retry}
              </Button>
            )}
          </div>
        ) : null}
        {order === null ? null : (
          <>
            <DecisionLine decision={sellerDecisionText(order.decision)} t={t} />
            {showsDeadline(order.status) ? (
              <p className="type-body-medium text-warning-text">{t.deadline.replace("{date}", formatDateTime(order.respondBy, locale))}</p>
            ) : null}
            {order.actions.confirm || order.actions.reject || order.actions.cancel ? (
              <div className="flex flex-wrap gap-2">
                {order.actions.confirm ? (
                  <Button disabled={pending} onClick={() => void act("confirm", {}, t.confirmed)}>
                    {pending && decision === null ? t.confirming : t.confirm}
                  </Button>
                ) : null}
                {order.actions.reject && decision === null ? (
                  <Button variant="outline" disabled={pending} onClick={() => setDecision({ kind: "reject" })}>
                    {t.reject}
                  </Button>
                ) : null}
                {order.actions.cancel && decision === null ? (
                  <Button variant="outline" disabled={pending} onClick={() => setDecision({ kind: "cancel" })}>
                    {t.cancelAfterConfirm}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {decision?.kind === "reject" && order.actions.reject ? (
              <ReasonForm
                title={t.rejectTitle}
                hint={t.rejectHint}
                reasons={SELLER_REJECTION_REASONS}
                submitLabel={t.submitReject}
                pending={pending}
                t={t}
                onSubmit={(reason) => void act("reject", sellerRejectionBody(reason), t.rejected)}
                onClose={() => setDecision(null)}
              />
            ) : null}
            {decision?.kind === "cancel" && order.actions.cancel ? (
              <ReasonForm
                title={t.sellerCancelTitle}
                hint={t.sellerCancelHint}
                reasons={SELLER_CANCELLATION_REASONS}
                submitLabel={t.submitCancel}
                pending={pending}
                t={t}
                onSubmit={(reason) => void act("cancel", sellerCancellationBody(reason), t.sellerCancelled)}
                onClose={() => setDecision(null)}
              />
            ) : null}
            <section className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
              <ItemList items={order.items} t={t} />
              <div className="flex flex-col gap-1 border-t border-border pt-3">
                <AmountRow label={t.productsSubtotal} value={formatMru(order.productsSubtotal, locale)} />
                <AmountRow label={t.deliveryFee} value={feeText(order.deliveryFee, t, locale)} />
                <AmountRow label={t.amountDue} value={formatMru(order.payment.amountDue, locale)} strong />
                <p className="type-body-small text-muted-foreground">
                  {t.paymentStatus} : {t.payment[order.payment.status]}
                </p>
                {order.payment.collectedAmount === null || order.payment.collectedAt === null ? null : (
                  <p className="type-body-small text-muted-foreground">
                    {t.collectedOn
                      .replace("{amount}", formatMru(order.payment.collectedAmount, locale))
                      .replace("{date}", formatDateTime(order.payment.collectedAt, locale))}
                  </p>
                )}
              </div>
            </section>
            {order.deliveryRecord === null ? null : (
              <DeliveryPanel
                shopOrderId={order.id}
                record={order.deliveryRecord}
                amountDue={order.payment.amountDue}
                t={t}
                call={call}
                onChanged={(next) => {
                  setNotice(next)
                  setReloads((count) => count + 1)
                }}
              />
            )}
            <DeliverySection order={order} t={t} />
          </>
        )}
        <TextLink href="/seller/orders">{t.backToShopOrders}</TextLink>
      </div>
    </main>
  )
}
