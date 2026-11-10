"use client"

import {
  CUSTOMER_CANCELLATION_REASONS,
  type CustomerCancellationReason,
  type CustomerOrder,
  type CustomerOrderListResponse,
  type CustomerShopOrder,
} from "@chicman/shared"
import { Banknote, Store } from "lucide-react"
import Link from "next/link"
import { useEffect, useState, type FormEvent } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { formatDateTime } from "@/lib/date-time"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { useOrderMessages, type OrderMessages } from "../messages"
import {
  accountOrderHref,
  CUSTOMER_ORDERS_PATH,
  customerCancellationBody,
  customerCancelPath,
  customerDecisionText,
  customerOrderPath,
  listQuery,
  needsReload,
  pageCount,
  showsDeadline,
  showsReturnsNotice,
  type CancellationTextError,
  type OrderFailure,
} from "../order-logic"
import { AmountRow, DecisionLine, feeText, ItemList, LabelBadge, Pagination, useOrderApi } from "./order-shared"

type ListView = { state: "loading" } | { state: "ready"; data: CustomerOrderListResponse } | { state: "failed"; failure: OrderFailure }

/** `/account/orders`: the customer's own orders, newest first, with one label per shop. */
export function CustomerOrderList() {
  const t = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useOrderApi()
  const [view, setView] = useState<ListView>({ state: "loading" })
  const [page, setPage] = useState(1)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<CustomerOrderListResponse>(`${CUSTOMER_ORDERS_PATH}${listQuery(page)}`).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      setView(outcome.state === "ok" ? { state: "ready", data: outcome.data } : { state: "failed", failure: outcome.failure })
    })
    return () => {
      cancelled = true
      setView({ state: "loading" })
    }
  }, [status, call, page, reloads])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <div className="flex flex-col gap-1">
        <h1 className="type-headline-large">{t.myOrders}</h1>
        <p className="type-body-medium text-muted-foreground">{t.myOrdersSubtitle}</p>
      </div>
      {view.state === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
      {view.state === "failed" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
          <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
            {t.retry}
          </Button>
        </div>
      ) : null}
      {view.state === "ready" && view.data.orders.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="type-body-medium text-muted-foreground">{t.noOrders}</p>
          <Link href={localizedPath(locale, "/products")} className={buttonVariants()}>
            {t.startShopping}
          </Link>
        </div>
      ) : null}
      {view.state === "ready" ? (
        <ul className="flex flex-col gap-3">
          {view.data.orders.map((order) => (
            <li key={order.id}>
              <Link
                href={accountOrderHref(order.id)}
                aria-label={`${t.openOrder} ${order.reference}`}
                className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-title-small" dir="ltr">
                    {order.reference}
                  </span>
                  <span className="type-title-small">{formatMru(order.total, locale)}</span>
                </span>
                <span className="type-body-small text-muted-foreground">
                  {t.placedOn.replace("{date}", formatDateTime(order.createdAt, locale))} · {t.items.replace("{count}", String(order.itemsCount))}
                </span>
                <span className="flex flex-col gap-1">
                  {order.shopOrders.map((shopOrder) => (
                    <span key={shopOrder.id} className="flex flex-wrap items-center gap-2">
                      <span dir="auto" className="type-body-medium">
                        {shopOrder.shopName}
                      </span>
                      <LabelBadge label={shopOrder.label} t={t} />
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {view.state === "ready" ? <Pagination page={page} pages={pageCount(view.data.total, view.data.pageSize)} onPage={setPage} t={t} /> : null}
      <TextLink href="/account">{t.backToAccount}</TextLink>
    </main>
  )
}

function CancelForm({
  shopOrder,
  t,
  pending,
  onCancel,
  onClose,
}: {
  shopOrder: CustomerShopOrder
  t: OrderMessages
  pending: boolean
  onCancel: (body: object) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState<CustomerCancellationReason | null>(null)
  const [text, setText] = useState("")
  const [error, setError] = useState<CancellationTextError | null>(null)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const checked = customerCancellationBody(reason, text)
    if ("error" in checked) return setError(checked.error)
    setError(null)
    onCancel(checked.body)
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/50 p-4">
      <p className="type-title-small">{t.cancelTitle.replace("{shop}", shopOrder.shop.name)}</p>
      <p className="type-body-small text-muted-foreground">{t.cancelHint}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1.5 type-label-large">{t.cancelReasonLabel}</legend>
        <div className="flex flex-wrap gap-2">
          <Chip pressed={reason === null} onPressedChange={() => setReason(null)}>
            {t.noReason}
          </Chip>
          {CUSTOMER_CANCELLATION_REASONS.map((value) => (
            <Chip key={value} pressed={reason === value} onPressedChange={() => setReason(value)}>
              {t.customerReasons[value]}
            </Chip>
          ))}
        </div>
      </fieldset>
      {reason === "OTHER" ? (
        <FormField
          label={t.otherTextLabel}
          dir="auto"
          maxLength={400}
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={error === null ? undefined : t.textErrors[error]}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? t.cancelling : t.confirmCancel}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
          {t.keepOrder}
        </Button>
      </div>
    </form>
  )
}

/**
 * Delivery progress (spec 12, section 9): the current dispatch, the number of
 * attempts, each failure reason translated, and the delivered time. Nothing
 * of the seller's internal data; a new attempt is asked for by phone.
 */
function DeliveryProgress({ shopOrder, t }: { shopOrder: CustomerShopOrder; t: OrderMessages }) {
  const locale = useLocale()
  const progress = shopOrder.deliveryProgress
  if (progress === null || progress.attemptsCount === 0) return null
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-muted p-3">
      <p className="type-body-small">{t.attemptsCount.replace("{count}", String(progress.attemptsCount))}</p>
      {progress.currentAttemptDispatchedAt === null ? null : (
        <p className="type-body-small">{t.currentAttempt.replace("{date}", formatDateTime(progress.currentAttemptDispatchedAt, locale))}</p>
      )}
      {progress.failures.map((failure) => (
        <p key={failure.attemptNumber} className="type-body-small text-warning-text">
          {t.failedAttempt
            .replace("{number}", String(failure.attemptNumber))
            .replace("{date}", formatDateTime(failure.failedAt, locale))
            .replace("{reason}", t.deliveryFailureReasons[failure.reason])}
        </p>
      ))}
      {progress.deliveredAt === null ? null : <p className="type-body-small">{t.deliveredOn.replace("{date}", formatDateTime(progress.deliveredAt, locale))}</p>}
      {shopOrder.label === "DELIVERY_FAILED_RETRY" ? <p className="type-body-small text-muted-foreground">{t.retryByPhone}</p> : null}
    </div>
  )
}

function ShopOrderSection({
  shopOrder,
  t,
  cancelling,
  pending,
  onOpenCancel,
  onCloseCancel,
  onCancel,
}: {
  shopOrder: CustomerShopOrder
  t: OrderMessages
  cancelling: boolean
  pending: boolean
  onOpenCancel: () => void
  onCloseCancel: () => void
  onCancel: (body: object) => void
}) {
  const locale = useLocale()
  return (
    <section aria-label={shopOrder.shop.name} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 type-title-medium">
          <Store aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
          <span dir="auto" className="min-w-0 break-words">
            {shopOrder.shop.name}
          </span>
        </h2>
        <LabelBadge label={shopOrder.label} t={t} />
      </div>
      <DecisionLine decision={customerDecisionText(shopOrder.decision)} t={t} />
      <DeliveryProgress shopOrder={shopOrder} t={t} />
      {showsDeadline(shopOrder.status) ? (
        <p className="type-body-small text-muted-foreground">{t.respondBy.replace("{date}", formatDateTime(shopOrder.respondBy, locale))}</p>
      ) : null}
      <ItemList items={shopOrder.items} t={t} />
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <AmountRow label={t.productsSubtotal} value={formatMru(shopOrder.productsSubtotal, locale)} />
        <AmountRow label={t.deliveryFee} value={feeText(shopOrder.deliveryFee, t, locale)} />
        <AmountRow label={t.amountDue} value={formatMru(shopOrder.payment.amountDue, locale)} strong />
        <p className="type-body-small text-muted-foreground">
          {t.paymentStatus} : {t.payment[shopOrder.payment.status]}
        </p>
      </div>
      <p className="type-body-small text-muted-foreground">
        {t.shopContact} : <span dir="ltr">{shopOrder.shop.contactPhone}</span>
        {shopOrder.shop.whatsappPhone === null ? null : (
          <>
            {" · "}
            {t.whatsapp} : <span dir="ltr">{shopOrder.shop.whatsappPhone}</span>
          </>
        )}
      </p>
      {showsReturnsNotice(shopOrder.status) ? <p className="rounded-2xl bg-muted p-3 type-body-small">{t.returnsNotice}</p> : null}
      {shopOrder.canCancel && !cancelling ? (
        <Button variant="outline" size="sm" className="self-start" onClick={onOpenCancel}>
          {t.cancelShopOrder}
        </Button>
      ) : null}
      {shopOrder.canCancel && cancelling ? <CancelForm shopOrder={shopOrder} t={t} pending={pending} onCancel={onCancel} onClose={onCloseCancel} /> : null}
    </section>
  )
}

type DetailView = { state: "loading" } | { state: "ready"; order: CustomerOrder } | { state: "failed"; failure: OrderFailure }

/** `/account/orders/[orderId]`: one order, each shop's part with its own status, and cancellation while pending. */
export function CustomerOrderDetail({ orderId }: { orderId: string }) {
  const t = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useOrderApi()
  const [view, setView] = useState<DetailView>({ state: "loading" })
  const [reloads, setReloads] = useState(0)
  const [cancelling, setCancelling] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState<{ tone: "info" | "error"; text: string } | null>(null)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<CustomerOrder>(customerOrderPath(orderId)).then((outcome) => {
      if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
      setView(outcome.state === "ok" ? { state: "ready", order: outcome.data } : { state: "failed", failure: outcome.failure })
    })
    return () => {
      cancelled = true
      setView({ state: "loading" })
      setCancelling(null)
      setNotice(null)
    }
  }, [status, call, orderId, reloads])

  async function cancel(shopOrderId: string, body: object) {
    setPending(true)
    setNotice(null)
    const outcome = await call<CustomerOrder>(customerCancelPath(orderId, shopOrderId), "POST", body)
    setPending(false)
    if (outcome.state === "stale" || outcome.state === "signed-out") return
    if (outcome.state === "ok") {
      setView({ state: "ready", order: outcome.data })
      setCancelling(null)
      setNotice({ tone: "info", text: t.cancelled })
      return
    }
    setNotice({ tone: "error", text: t.failures[outcome.failure] })
    if (needsReload(outcome.failure)) {
      setCancelling(null)
      setReloads((count) => count + 1)
    }
  }

  const order = view.state === "ready" ? view.order : null
  const delivery = order?.shopOrders[0]?.delivery

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <div className="flex flex-col gap-1">
        <h1 className="type-headline-large">{t.myOrders}</h1>
        {order === null ? null : (
          <p className="type-body-medium text-muted-foreground">
            {t.reference} : <span dir="ltr">{order.reference}</span> · {t.placedOn.replace("{date}", formatDateTime(order.createdAt, locale))}
          </p>
        )}
      </div>
      {notice === null ? null : <FormMessage tone={notice.tone}>{notice.text}</FormMessage>}
      {view.state === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
      {view.state === "failed" ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
          {view.failure === "not-found" ? null : (
            <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
              {t.retry}
            </Button>
          )}
        </div>
      ) : null}
      {order === null
        ? null
        : order.shopOrders.map((shopOrder) => (
            <ShopOrderSection
              key={shopOrder.id}
              shopOrder={shopOrder}
              t={t}
              cancelling={cancelling === shopOrder.id}
              pending={pending}
              onOpenCancel={() => {
                setNotice(null)
                setCancelling(shopOrder.id)
              }}
              onCloseCancel={() => setCancelling(null)}
              onCancel={(body) => void cancel(shopOrder.id, body)}
            />
          ))}
      {order === null || delivery === undefined ? null : (
        <section className="flex flex-col gap-2 rounded-3xl border border-border bg-surface p-4 sm:p-6">
          <h2 className="type-title-medium">{t.deliverTo}</h2>
          <p dir="auto" className="type-title-small">
            {delivery.recipientName}
          </p>
          <p dir="auto" className="type-body-medium">{`${delivery.district}, ${delivery.city}`}</p>
          <p className="type-body-small text-muted-foreground">
            {t.landmark} : <span dir="auto">{delivery.landmark}</span>
          </p>
          <p className="type-body-small">
            {t.deliveryPhone} : <span dir="ltr">{delivery.deliveryPhone}</span>
          </p>
          <p className="flex items-center gap-2 type-title-small">
            <Banknote aria-hidden className="size-icon-action shrink-0" />
            {t.cashOnDelivery}
          </p>
          <AmountRow label={t.total} value={formatMru(order.total, locale)} strong />
        </section>
      )}
      <TextLink href="/account/orders">{t.backToOrders}</TextLink>
    </main>
  )
}
