"use client"

import {
  CUSTOMER_CANCELLATION_REASONS,
  SELLER_CANCELLATION_REASONS,
  SHOP_ORDER_STATUSES,
  SYSTEM_CANCELLATION_REASONS,
  type AdminShopOrderDetail,
  type AdminShopOrderListResponse,
  type AdminStatusEvent,
  type DeliveryStatus,
  type ShopOrderReasonCode,
  type ShopOrderStatus,
} from "@chicman/shared"
import Link from "next/link"
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Chip } from "@/components/ui/chip"
import { Input } from "@/components/ui/input"
import { FormMessage } from "@/features/auth/components/form-field"
import { TextLink } from "@/features/auth/components/text-link"
import { useOrderMessages } from "@/features/orders/messages"
import { AmountRow, ItemList, LabelBadge } from "@/features/orders/components/order-shared"
import { formatDateTime } from "@/lib/date-time"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import {
  ADMIN_AREA_HREF,
  adminOrderCancelPath,
  adminOrderHref,
  adminOrderListPath,
  adminOrderPath,
  adminPaymentNotePath,
  adminShopHref,
  buildOrderCancellation,
  buildPaymentNote,
  EMPTY_ORDER_FILTERS,
  pageCount,
  type AdminOrderFilters,
  type OrderFilterError,
} from "../admin-dashboard"
import type { AdminOutcome } from "../admin-shops"
import { useAdminMessages, type AdminMessages } from "../messages"
import { AdminPage, errorText, Pagination, postJson, ReasonForm, useAdminApi, type GuardedAdminOutcome } from "./admin-shared"

const REASON_CODES: readonly string[] = [...SELLER_CANCELLATION_REASONS, ...CUSTOMER_CANCELLATION_REASONS, ...SYSTEM_CANCELLATION_REASONS]
const isReasonCode = (value: string | null): value is ShopOrderReasonCode => value !== null && REASON_CODES.includes(value)
const isOrderStatus = (value: string | null): value is ShopOrderStatus => value !== null && (SHOP_ORDER_STATUSES as readonly string[]).includes(value)

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="contents">
      <dt className="type-label-large text-muted-foreground">{label}</dt>
      <dd className="type-body-medium break-words">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="type-title-large">{title}</h2>
      {children}
    </section>
  )
}

/** An identifier (user, product): kept left-to-right in Arabic. */
const Id = ({ value }: { value: string }) => (
  <span dir="ltr" className="break-all">
    {value}
  </span>
)

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

/** `/admin/orders`: every shop order, newest first; filters by status, shop, reference, and placement days (UTC). */
export function AdminOrderList({ initialShopId }: { initialShopId: string | null }) {
  const t = useAdminMessages()
  const orderText = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useAdminApi()
  const [filters, setFilters] = useState<AdminOrderFilters>({ ...EMPTY_ORDER_FILTERS, shopId: initialShopId })
  const [draft, setDraft] = useState({ reference: "", from: "", to: "" })
  const [filterError, setFilterError] = useState<OrderFilterError | null>(null)
  const [page, setPage] = useState(1)
  const [outcome, setOutcome] = useState<AdminOutcome<AdminShopOrderListResponse> | null>(null)

  const request = adminOrderListPath(filters, page)
  const path = request.ok ? request.path : null

  useEffect(() => {
    if (status !== "signed-in" || path === null) return
    let cancelled = false
    void call<AdminShopOrderListResponse>(path).then((result) => {
      if (!cancelled && result.state !== "stale") setOutcome(result)
    })
    return () => {
      cancelled = true
      setOutcome(null)
    }
  }, [status, call, path])

  const update = (next: Partial<AdminOrderFilters>) => {
    setFilters((current) => ({ ...current, ...next }))
    setPage(1)
  }
  const onApply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const candidate = { ...filters, ...draft }
    const checked = adminOrderListPath(candidate, 1)
    if (!checked.ok) return setFilterError(checked.error)
    setFilterError(null)
    update(draft)
  }
  const clear = () => {
    setDraft({ reference: "", from: "", to: "" })
    setFilterError(null)
    update(EMPTY_ORDER_FILTERS)
  }

  const shopName = outcome?.state === "ok" ? outcome.data.shopOrders.find((row) => row.shop.id === filters.shopId)?.shop.name : undefined
  const hasFilters = filters.status !== null || filters.shopId !== null || filters.reference !== "" || filters.from !== "" || filters.to !== ""

  return (
    <AdminPage>
      <div className="flex w-full max-w-3xl flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="type-headline-small">{t.ordersTitle}</h1>
          <p className="type-body-medium text-muted-foreground">{t.ordersSubtitle}</p>
        </div>

        <form className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4" onSubmit={onApply} noValidate>
          <label className="flex flex-col gap-1.5">
            <span className="type-label-large">{t.referenceSearch}</span>
            <Input
              type="search"
              dir="ltr"
              placeholder={t.referencePlaceholder}
              value={draft.reference}
              maxLength={40}
              aria-invalid={filterError === "reference" ? true : undefined}
              onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))}
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-40 flex-1 flex-col gap-1.5">
              <span className="type-label-large">{t.placedFrom}</span>
              <Input type="date" value={draft.from} onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1.5">
              <span className="type-label-large">{t.placedTo}</span>
              <Input
                type="date"
                value={draft.to}
                aria-invalid={filterError === "dateOrder" ? true : undefined}
                onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              />
            </label>
          </div>
          {filterError ? <FormMessage tone="error">{t.filterErrors[filterError]}</FormMessage> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit">{t.apply}</Button>
            {hasFilters ? (
              <Button type="button" variant="ghost" onClick={clear}>
                {t.clearFilters}
              </Button>
            ) : null}
          </div>
        </form>

        <div role="group" aria-label={t.statusFilterLabel} className="flex flex-wrap gap-2">
          <Chip pressed={filters.status === null} onPressedChange={() => update({ status: null })}>
            {t.filterAll}
          </Chip>
          {SHOP_ORDER_STATUSES.map((value) => (
            <Chip key={value} pressed={filters.status === value} onPressedChange={() => update({ status: value })}>
              {t.orderStatus[value]}
            </Chip>
          ))}
        </div>
        {filters.shopId !== null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              <span dir="auto">{t.shopFilter.replace("{shop}", shopName ?? t.shopFilterUnknown)}</span>
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => update({ shopId: null })}>
              {t.allShops}
            </Button>
          </div>
        ) : null}

        {outcome === null ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
        {outcome !== null && outcome.state !== "ok" ? <FormMessage tone="error">{errorText(outcome.state, t, "order")}</FormMessage> : null}
        {outcome?.state === "ok" && outcome.data.shopOrders.length === 0 ? <FormMessage tone="info">{t.noOrders}</FormMessage> : null}
        {outcome?.state === "ok" && outcome.data.total > 0 ? (
          <p className="type-body-small text-muted-foreground">{t.resultCount.replace("{count}", String(outcome.data.total))}</p>
        ) : null}
        {outcome?.state === "ok" ? (
          <ul className="flex flex-col gap-3">
            {outcome.data.shopOrders.map((row) => (
              <li key={row.id}>
                <Link
                  href={adminOrderHref(row.id)}
                  aria-label={`${t.openOrder} ${row.orderReference}`}
                  className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="type-title-small" dir="ltr">
                      {row.orderReference}
                    </span>
                    <LabelBadge label={row.label} t={orderText} />
                  </span>
                  <span dir="auto" className="type-body-medium break-words">
                    {row.shop.name}
                  </span>
                  <span className="type-body-small text-muted-foreground">
                    {t.placedOn.replace("{date}", formatDateTime(row.createdAt, locale))} · {formatMru(row.total, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {outcome?.state === "ok" ? <Pagination page={page} pages={pageCount(outcome.data.total, outcome.data.pageSize)} onPage={setPage} t={t} /> : null}
      </div>
    </AdminPage>
  )
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

function statusText(value: string | null, t: AdminMessages, kind: "order" | "delivery"): string {
  if (value === null) return "—"
  if (kind === "order") return isOrderStatus(value) ? t.orderStatus[value] : value
  return value in t.deliveryStatus ? t.deliveryStatus[value as DeliveryStatus] : value
}

/** Status history, oldest first, with every internal field (administrators only). */
function EventList({ events, kind, t, reasons }: { events: readonly AdminStatusEvent[]; kind: "order" | "delivery"; t: AdminMessages; reasons: Record<ShopOrderReasonCode, string> }) {
  const locale = useLocale()
  return (
    <ol className="flex flex-col gap-2">
      {events.map((event) => (
        <li key={event.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
          <p className="type-label-large">{`${statusText(event.fromStatus, t, kind)} → ${statusText(event.toStatus, t, kind)} · ${t.actor[event.actorType]}`}</p>
          <p className="text-muted-foreground">
            {formatDateTime(event.createdAt, locale)}
            {event.actorUserId === null ? null : (
              <>
                {` · ${t.by} `}
                <Id value={event.actorUserId} />
              </>
            )}
          </p>
          {event.reasonCode === null ? null : <p>{t.reasonCode.replace("{reason}", isReasonCode(event.reasonCode) ? reasons[event.reasonCode] : event.reasonCode)}</p>}
          {event.reasonText === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">
              {t.customerText.replace("{text}", event.reasonText)}
            </p>
          )}
          {event.internalReason === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">{`${t.internalReason} : ${event.internalReason}`}</p>
          )}
          {event.internalNote === null ? null : (
            <p dir="auto" className="break-words whitespace-pre-wrap">{`${t.internalNote} : ${event.internalNote}`}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

function DeliverySnapshot({ order, t }: { order: AdminShopOrderDetail; t: AdminMessages }) {
  const { delivery } = order
  return (
    <Section title={t.deliverySnapshotTitle}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <Field label={t.recipient} value={<span dir="auto">{delivery.recipientName}</span>} />
        <Field label={t.deliveryPhone} value={<span dir="ltr">{delivery.deliveryPhone}</span>} />
        {delivery.label === null ? null : <Field label={t.addressLabel} value={<span dir="auto">{delivery.label}</span>} />}
        <Field label={t.location} value={<span dir="auto">{`${delivery.district}, ${delivery.city}`}</span>} />
        <Field label={t.landmark} value={<span dir="auto" className="whitespace-pre-wrap">{delivery.landmark}</span>} />
        <Field
          label={t.locationSource[delivery.locationSource]}
          value={
            <>
              <span dir="ltr">{`${delivery.latitude.toFixed(6)}, ${delivery.longitude.toFixed(6)}`}</span>
              {delivery.accuracyMeters === null ? null : ` (${t.accuracy.replace("{meters}", String(delivery.accuracyMeters))})`}
            </>
          }
        />
      </dl>
      <a
        className="type-body-small underline"
        target="_blank"
        rel="noopener noreferrer"
        href={`https://www.openstreetmap.org/?mlat=${delivery.latitude}&mlon=${delivery.longitude}#map=17/${delivery.latitude}/${delivery.longitude}`}
      >
        {t.openMap}
      </a>
    </Section>
  )
}

function DeliveryRecord({ order, t, reasons }: { order: AdminShopOrderDetail; t: AdminMessages; reasons: Record<ShopOrderReasonCode, string> }) {
  const locale = useLocale()
  const orderText = useOrderMessages()
  const record = order.deliveryRecord
  if (record === null) {
    return (
      <Section title={t.deliveryRecordTitle}>
        <p className="type-body-medium text-muted-foreground">{t.noDeliveryRecord}</p>
      </Section>
    )
  }
  return (
    <Section title={t.deliveryRecordTitle}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t.deliveryStatus[record.status]}</Badge>
        {record.closedAt === null ? null : <span className="type-body-small text-muted-foreground">{t.closedAt.replace("{date}", formatDateTime(record.closedAt, locale))}</span>}
      </div>
      {record.autoCloseAt === null ? null : <p className="type-body-small text-muted-foreground">{t.autoCloseAt.replace("{date}", formatDateTime(record.autoCloseAt, locale))}</p>}
      {record.attempts.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="type-title-small">{t.attemptsTitle}</h3>
          <ol className="flex flex-col gap-2">
            {record.attempts.map((attempt) => (
              <li key={attempt.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
                <p>
                  {t.attemptLine
                    .replace("{number}", String(attempt.number))
                    .replace("{date}", formatDateTime(attempt.dispatchedAt, locale))
                    .replace("{by}", t.by)
                    .replace("{user}", "")}
                  <Id value={attempt.dispatchedByUserId} />
                </p>
                <p className="text-muted-foreground">
                  {attempt.outcome === null ? (
                    t.attemptInProgress
                  ) : (
                    <>
                      {t.attemptOutcomeLine
                        .replace("{outcome}", t.attemptOutcome[attempt.outcome])
                        .replace("{date}", formatDateTime(attempt.outcomeAt ?? attempt.dispatchedAt, locale))
                        .replace("{by}", t.by)
                        .replace("{user}", "")}
                      {attempt.outcomeByUserId === null ? null : <Id value={attempt.outcomeByUserId} />}
                    </>
                  )}
                </p>
                {attempt.failureReason === null ? null : <p>{orderText.deliveryFailureReasons[attempt.failureReason]}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {record.events.length === 0 ? null : (
        <div className="flex flex-col gap-2">
          <h3 className="type-title-small">{t.deliveryHistory}</h3>
          <EventList events={record.events} kind="delivery" t={t} reasons={reasons} />
        </div>
      )}
    </Section>
  )
}

function PaymentSection({ order, t, onNote }: { order: AdminShopOrderDetail; t: AdminMessages; onNote: (body: unknown) => Promise<GuardedAdminOutcome<unknown>> }) {
  const locale = useLocale()
  const { payment } = order
  return (
    <Section title={t.paymentTitle}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t.paymentStatus[payment.status]}</Badge>
        <span className="type-body-small text-muted-foreground">{t.cashOnDelivery}</span>
      </div>
      <AmountRow label={t.amountDue} value={formatMru(payment.amountDue, locale)} />
      {payment.collectedAmount === null || payment.collectedAt === null ? null : (
        <p className="type-body-small">{t.collected.replace("{amount}", formatMru(payment.collectedAmount, locale)).replace("{date}", formatDateTime(payment.collectedAt, locale))}</p>
      )}
      <h3 className="type-title-small">{t.paymentEvents}</h3>
      <ol className="flex flex-col gap-2">
        {payment.events.map((event) => (
          <li key={event.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
            <p className="type-label-large">
              {t.paymentEventType[event.type]}
              {event.amount === null ? null : ` · ${formatMru(event.amount, locale)}`}
              {` · ${t.actor[event.actorType]}`}
            </p>
            <p className="text-muted-foreground">
              {formatDateTime(event.createdAt, locale)}
              {event.actorUserId === null ? null : (
                <>
                  {` · ${t.by} `}
                  <Id value={event.actorUserId} />
                </>
              )}
            </p>
            {event.reason === null ? null : (
              <p dir="auto" className="break-words whitespace-pre-wrap">
                {event.reason}
              </p>
            )}
          </li>
        ))}
      </ol>
      <ReasonForm
        t={t}
        label={t.addNote}
        reasonLabel={t.noteReason}
        reasonHint={t.noteHint}
        withNote={false}
        subject="order"
        build={(reason) => {
          const result = buildPaymentNote(reason)
          return result.ok ? result : { ok: false, errors: { reason: result.error } }
        }}
        submit={onNote}
      />
    </Section>
  )
}

/** `/admin/orders/[shopOrderId]`: everything about one shop order; cancel before dispatch and annotate the payment (D6, D9). */
export function AdminOrderDetail({ shopOrderId }: { shopOrderId: string }) {
  const t = useAdminMessages()
  const orderText = useOrderMessages()
  const locale = useLocale()
  const { status, call } = useAdminApi()
  const [outcome, setOutcome] = useState<AdminOutcome<AdminShopOrderDetail> | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const result = await call<AdminShopOrderDetail>(adminOrderPath(shopOrderId))
    if (result.state !== "stale") setOutcome(result)
  }, [call, shopOrderId])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<AdminShopOrderDetail>(adminOrderPath(shopOrderId)).then((result) => {
      if (!cancelled && result.state !== "stale") setOutcome(result)
    })
    return () => {
      cancelled = true
    }
  }, [status, call, shopOrderId])

  const post = useCallback(
    async (path: string, body: unknown, done: string) => {
      setNotice(null)
      const result = await call<unknown>(path, postJson(body))
      if (result.state === "ok") setNotice(done)
      // The order changed: show its current state (a conflict says so in the form).
      if (result.state === "ok" || result.state === "conflict") await load()
      return result
    },
    [call, load]
  )

  if (outcome === null) {
    return (
      <AdminPage>
        <FormMessage tone="info">{t.loading}</FormMessage>
      </AdminPage>
    )
  }
  if (outcome.state !== "ok") {
    return (
      <AdminPage>
        <FormMessage tone="error">{errorText(outcome.state, t, "order")}</FormMessage>
        <TextLink href={ADMIN_AREA_HREF.orders}>{t.backToOrders}</TextLink>
      </AdminPage>
    )
  }

  const order = outcome.data
  const reasons = orderText.reasons
  return (
    <AdminPage>
      <div className="flex w-full max-w-3xl flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="type-headline-small" dir="ltr">
            {order.orderReference}
          </h1>
          <LabelBadge label={order.label} t={orderText} />
        </div>
        <p className="type-body-medium text-muted-foreground">{t.placedOn.replace("{date}", formatDateTime(order.createdAt, locale))}</p>
        {notice ? <FormMessage tone="info">{notice}</FormMessage> : null}
      </div>

      <Section title={t.decisionTitle}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <Field label={t.shop} value={<Link className="underline-offset-4 hover:underline" href={adminShopHref(order.shop.id)}><span dir="auto">{order.shop.name}</span></Link>} />
          <Field label={t.shopContact} value={<span dir="ltr">{order.shop.whatsappPhone === null ? order.shop.contactPhone : `${order.shop.contactPhone} · ${order.shop.whatsappPhone}`}</span>} />
          <Field label={t.customer} value={<Id value={order.customerUserId} />} />
          <Field label={t.statusField} value={t.orderStatus[order.status]} />
          <Field label={t.respondByField} value={formatDateTime(order.respondBy, locale)} />
          {order.decidedAt === null ? null : <Field label={t.decidedField} value={formatDateTime(order.decidedAt, locale)} />}
          {order.closedAt === null ? null : <Field label={t.closedField} value={formatDateTime(order.closedAt, locale)} />}
        </dl>
        {order.decision.cancelledBy === null ? null : <p className="type-body-medium">{t.cancelledBy.replace("{actor}", t.actor[order.decision.cancelledBy])}</p>}
        {order.decision.reasonCode === null ? null : (
          <p className="type-body-medium">{t.reasonCode.replace("{reason}", isReasonCode(order.decision.reasonCode) ? reasons[order.decision.reasonCode] : order.decision.reasonCode)}</p>
        )}
        {order.decision.reasonText === null ? null : (
          <p dir="auto" className="type-body-medium break-words whitespace-pre-wrap">
            {t.customerText.replace("{text}", order.decision.reasonText)}
          </p>
        )}
        {order.decision.internalReason === null ? null : (
          <p dir="auto" className="type-body-medium break-words whitespace-pre-wrap">{`${t.internalReason} : ${order.decision.internalReason}`}</p>
        )}
        {order.decision.internalNote === null ? null : (
          <p dir="auto" className="type-body-medium break-words whitespace-pre-wrap">{`${t.internalNote} : ${order.decision.internalNote}`}</p>
        )}
        {order.canCancel ? (
          <div className="flex flex-col gap-2">
            <p className="type-body-small text-muted-foreground">{t.cancelHint}</p>
            <ReasonForm
              key={order.status}
              t={t}
              label={t.cancelOrder}
              reasonLabel={t.internalReason}
              reasonHint={t.internalReasonHint}
              destructive
              subject="order"
              build={buildOrderCancellation}
              submit={(body) => post(adminOrderCancelPath(order.id), body, t.orderCancelled)}
            />
          </div>
        ) : (
          <p className="type-body-small text-muted-foreground">{t.noCancel}</p>
        )}
        <p className="type-body-small text-muted-foreground">{t.noOtherAction}</p>
      </Section>

      <Section title={t.itemsTitle}>
        <ItemList items={order.items} t={orderText} />
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <AmountRow label={t.productsSubtotal} value={formatMru(order.productsSubtotal, locale)} />
          <AmountRow label={t.deliveryFee} value={formatMru(order.deliveryFee, locale)} />
          <AmountRow label={t.total} value={formatMru(order.total, locale)} strong />
        </div>
      </Section>

      <DeliverySnapshot order={order} t={t} />
      <DeliveryRecord order={order} t={t} reasons={reasons} />
      <PaymentSection order={order} t={t} onNote={(body) => post(adminPaymentNotePath(order.id), body, t.noteAdded)} />

      <Section title={t.orderHistory}>
        <EventList events={order.history} kind="order" t={t} reasons={reasons} />
      </Section>

      <Section title={t.stockTitle}>
        <ol className="flex flex-col gap-2">
          {order.stockMovements.map((movement) => (
            <li key={movement.id} className="flex flex-col gap-0.5 rounded-2xl bg-muted p-3 type-body-small">
              <p className="type-label-large">
                {t.stockLine.replace("{type}", t.stockType[movement.type]).replace("{quantity}", String(movement.quantity)).replace("{product}", "")}
                <Id value={movement.productId} />
              </p>
              <p className="text-muted-foreground">{formatDateTime(movement.createdAt, locale)}</p>
              {movement.applied || movement.skipReason === null ? null : <p>{t.stockSkipped.replace("{reason}", t.skipReason[movement.skipReason])}</p>}
            </li>
          ))}
        </ol>
      </Section>

      <TextLink href={ADMIN_AREA_HREF.orders}>{t.backToOrders}</TextLink>
    </AdminPage>
  )
}
