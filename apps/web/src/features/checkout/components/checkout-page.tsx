"use client"

import type { CheckoutShop, CheckoutSummary, CustomerOrder } from "@chicman/shared"
import { Banknote, ImageOff, MapPin, Store, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-provider"
import { FormField, FormMessage } from "@/features/auth/components/form-field"
import { useCart } from "@/features/cart/cart-provider"
import { apiRequest, type ApiResult } from "@/lib/api-client"
import { formatDateTime } from "@/lib/date-time"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import {
  ADDRESS_SELECTION_PATH,
  canPlace,
  interpretPlacementResult,
  interpretSummaryResult,
  keepsAttemptKey,
  needsFreshSummary,
  NEW_ADDRESS_FOR_CHECKOUT_PATH,
  newIdempotencyKey,
  placementBody,
  placementRequest,
  recipientError,
  summaryPath,
  type CheckoutFailure,
  type PlacementOutcome,
  type RecipientError,
  type SummaryOutcome,
} from "../checkout-logic"
import { accountOrderHref } from "../../orders/order-logic"
import { problemText, useCheckoutMessages, type CheckoutMessages } from "../messages"

type View =
  | { kind: "loading" }
  | { kind: "needs-setup" }
  | { kind: "failed"; failure: CheckoutFailure }
  | { kind: "ready"; summary: CheckoutSummary }
  | { kind: "placed"; order: CustomerOrder }

function Thumbnail({ url }: { url: string | null }) {
  return (
    <div className="aspect-[3/4] w-14 shrink-0 self-start overflow-hidden rounded-2xl bg-muted">
      {url === null ? (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <ImageOff aria-hidden className="size-icon-inline" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- verified media URL, already normalized by the server
        <img src={url} alt="" loading="lazy" className="size-full object-cover" />
      )}
    </div>
  )
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex flex-wrap items-center justify-between gap-2">
      <span className="type-body-medium text-muted-foreground">{label}</span>
      <span className={strong ? "type-title-large" : "type-title-small"}>{value}</span>
    </p>
  )
}

function feeText(fee: string | null, t: CheckoutMessages, locale: ReturnType<typeof useLocale>): string {
  if (fee === null) return t.feeNotSet
  return fee === "0.00" ? t.freeDelivery : formatMru(fee, locale)
}

function ShopSection({ group, t }: { group: CheckoutShop; t: CheckoutMessages }) {
  const locale = useLocale()
  return (
    <section aria-label={group.shop.name} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-2 type-title-medium">
        <Store aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
        <span className="sr-only">{t.soldBy} : </span>
        <span dir="auto" className="min-w-0 break-words">
          {group.shop.name}
        </span>
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {group.items.map((item) => (
          <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
            <Thumbnail url={item.imageUrl} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p dir="auto" className="type-title-small break-words">
                {item.name}
              </p>
              {item.size === null ? null : (
                <p className="type-body-small text-muted-foreground">
                  {t.size} : <span dir="auto">{item.size}</span>
                </p>
              )}
              {item.color === null ? null : (
                <p className="type-body-small text-muted-foreground">
                  {t.color} : <span dir="auto">{item.color}</span>
                </p>
              )}
              <p className="type-body-small text-muted-foreground">
                {t.quantityTimesPrice.replace("{quantity}", String(item.quantity)).replace("{price}", formatMru(item.unitPrice, locale))}
              </p>
            </div>
            <p className="shrink-0 type-title-small">{formatMru(item.subtotal, locale)}</p>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <Row label={t.productsSubtotal} value={formatMru(group.productsSubtotal, locale)} />
        <Row label={t.deliveryFee} value={feeText(group.deliveryFee, t, locale)} />
        {group.total === null ? null : <Row label={t.shopTotal} value={formatMru(group.total, locale)} />}
      </div>
    </section>
  )
}

function AddressSection({ summary, t }: { summary: CheckoutSummary; t: CheckoutMessages }) {
  const { address } = summary
  return (
    <section aria-labelledby="checkout-address" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 id="checkout-address" className="flex items-center gap-2 type-title-medium">
        <MapPin aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
        {t.addressTitle}
      </h2>
      {address === null ? (
        <div className="flex flex-col items-start gap-3">
          <p className="type-body-medium text-warning-text">{t.addressRequired}</p>
          <Link href={NEW_ADDRESS_FOR_CHECKOUT_PATH} className={buttonVariants()}>
            {t.addAddress}
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {address.label === null ? null : (
            <p dir="auto" className="type-title-small">
              {address.label}
            </p>
          )}
          <p dir="auto" className="type-body-medium">{`${address.district}, ${address.city}`}</p>
          <p className="type-body-small text-muted-foreground">
            {t.landmark} : <span dir="auto">{address.landmark}</span>
          </p>
          <p className="type-body-small">
            {t.deliveryPhone} : <span dir="ltr">{address.deliveryPhone}</span>
          </p>
          <p className="type-body-small text-muted-foreground">{t.phoneHint}</p>
          <Link href={ADDRESS_SELECTION_PATH} className={`${buttonVariants({ variant: "outline", size: "sm" })} mt-2 self-start`}>
            {t.changeAddress}
          </Link>
        </div>
      )}
    </section>
  )
}

function Problems({ summary, t }: { summary: CheckoutSummary; t: CheckoutMessages }) {
  if (summary.problems.length === 0) return null
  return (
    <section aria-labelledby="checkout-problems" className="flex flex-col gap-3 rounded-3xl bg-warning/15 p-4 text-warning-text sm:p-6">
      <h2 id="checkout-problems" className="flex items-center gap-2 type-title-small">
        <TriangleAlert aria-hidden className="size-icon-action shrink-0" />
        {t.problemsTitle}
      </h2>
      <ul className="flex list-disc flex-col gap-1 ps-6 type-body-small">
        {summary.problems.map((problem, index) => (
          <li key={`${problem.code}-${"itemId" in problem ? problem.itemId : "shopId" in problem ? problem.shopId : index}`} dir="auto">
            {problemText(problem, summary, t)}
          </li>
        ))}
      </ul>
      <Link href="/cart" className={`${buttonVariants({ variant: "outline", size: "sm" })} self-start`}>
        {t.goToCart}
      </Link>
    </section>
  )
}

function PaymentSection({ t }: { t: CheckoutMessages }) {
  return (
    <section aria-labelledby="checkout-payment" className="flex flex-col gap-2 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 id="checkout-payment" className="type-title-medium">
        {t.paymentTitle}
      </h2>
      <p className="flex items-center gap-2 type-title-small">
        <Banknote aria-hidden className="size-icon-action shrink-0" />
        {t.cashOnDelivery}
      </p>
      <p className="type-body-small text-muted-foreground">{t.cashOnDeliveryHint}</p>
    </section>
  )
}

function SummaryForm({
  summary,
  failure,
  pending,
  onPlace,
  t,
}: {
  summary: CheckoutSummary
  failure: CheckoutFailure | null
  pending: boolean
  onPlace: (recipientName: string) => void
  t: CheckoutMessages
}) {
  const locale = useLocale()
  const [recipient, setRecipient] = useState(summary.defaultRecipientName)
  const [error, setError] = useState<RecipientError | null>(null)
  const placeable = canPlace(summary)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const problem = recipientError(recipient)
    setError(problem)
    if (problem === null) onPlace(recipient)
  }

  return (
    <form onSubmit={submit} noValidate aria-label={t.summary} className="flex flex-col gap-4">
      <section aria-labelledby="checkout-recipient" className="flex flex-col gap-2 rounded-3xl border border-border bg-surface p-4 sm:p-6">
        <h2 id="checkout-recipient" className="type-title-medium">
          {t.recipientTitle}
        </h2>
        <FormField
          label={t.recipientLabel}
          autoComplete="name"
          dir="auto"
          maxLength={200}
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          error={error === null ? undefined : t.recipientErrors[error]}
        />
        <p className="type-body-small text-muted-foreground">{t.recipientHint}</p>
      </section>
      <aside aria-label={t.summary} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
        <h2 className="type-title-medium">{t.summary}</h2>
        <Row label={t.productsSubtotal} value={formatMru(summary.productsSubtotal, locale)} />
        <Row label={t.deliveryFeesTotal} value={summary.deliveryFeeTotal === null ? t.feeNotSet : formatMru(summary.deliveryFeeTotal, locale)} />
        {summary.total === null ? null : <Row label={t.total} value={formatMru(summary.total, locale)} strong />}
        {summary.shops.length > 1 ? <p className="type-body-small text-muted-foreground">{t.perShopNote}</p> : null}
        {failure === null ? null : <FormMessage tone="error">{t.failures[failure]}</FormMessage>}
        <Button type="submit" size="lg" disabled={!placeable || pending}>
          {pending ? t.placing : t.place}
        </Button>
      </aside>
    </form>
  )
}

function Confirmation({ order, t }: { order: CustomerOrder; t: CheckoutMessages }) {
  const locale = useLocale()
  const delivery = order.shopOrders[0]?.delivery
  return (
    <div className="flex flex-col gap-4">
      <section aria-labelledby="checkout-confirmed" className="flex flex-col gap-2 rounded-3xl bg-success/15 p-4 sm:p-6">
        <h2 id="checkout-confirmed" className="type-headline-small text-success-text">
          {t.confirmedTitle}
        </h2>
        <p className="type-body-medium">{t.confirmedBody}</p>
        <p className="type-body-medium">
          {t.reference} : <span className="type-title-small" dir="ltr">{order.reference}</span>
        </p>
      </section>
      {order.shopOrders.map((shopOrder) => (
        <section key={shopOrder.id} aria-label={shopOrder.shop.name} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
          <h3 className="flex items-center gap-2 type-title-medium">
            <Store aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
            <span dir="auto" className="min-w-0 break-words">
              {shopOrder.shop.name}
            </span>
          </h3>
          <p className="type-body-medium">
            {t.status} : <span className="type-title-small">{t.labels[shopOrder.label]}</span>
          </p>
          <p className="type-body-small text-muted-foreground">{t.respondBy.replace("{date}", formatDateTime(shopOrder.respondBy, locale))}</p>
          <ul className="flex flex-col divide-y divide-border">
            {shopOrder.items.map((item) => (
              <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <Thumbnail url={item.imageUrl} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p dir="auto" className="type-title-small break-words">
                    {item.productName}
                  </p>
                  {[item.size === null ? null : `${t.size} : ${item.size}`, item.color === null ? null : `${t.color} : ${item.color}`]
                    .filter((line): line is string => line !== null)
                    .map((line) => (
                      <p key={line} dir="auto" className="type-body-small text-muted-foreground">
                        {line}
                      </p>
                    ))}
                  <p className="type-body-small text-muted-foreground">
                    {t.quantityTimesPrice.replace("{quantity}", String(item.quantity)).replace("{price}", formatMru(item.unitPrice, locale))}
                  </p>
                </div>
                <p className="shrink-0 type-title-small">{formatMru(item.lineTotal, locale)}</p>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <Row label={t.productsSubtotal} value={formatMru(shopOrder.productsSubtotal, locale)} />
            <Row label={t.deliveryFee} value={feeText(shopOrder.deliveryFee, t, locale)} />
            <Row label={t.amountDue} value={formatMru(shopOrder.payment.amountDue, locale)} />
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
        </section>
      ))}
      <section className="flex flex-col gap-2 rounded-3xl border border-border bg-surface p-4 sm:p-6">
        {delivery === undefined ? null : (
          <>
            <h3 className="type-title-medium">{t.deliverTo}</h3>
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
          </>
        )}
        <p className="flex items-center gap-2 type-title-small">
          <Banknote aria-hidden className="size-icon-action shrink-0" />
          {t.cashOnDelivery}
        </p>
        <Row label={t.deliveryFeesTotal} value={formatMru(order.deliveryFeeTotal, locale)} />
        <Row label={t.total} value={formatMru(order.total, locale)} strong />
      </section>
      <div className="flex flex-wrap gap-2">
        <Link href={accountOrderHref(order.id)} className={buttonVariants()}>
          {t.viewOrder}
        </Link>
        <Link href={localizedPath(locale, "/products")} className={buttonVariants({ variant: "outline" })}>
          {t.continueShopping}
        </Link>
      </div>
    </div>
  )
}

/**
 * `/checkout` (spec 10): the summary the API works out, the address and the
 * recipient, cash on delivery, and the placement. Every figure and problem comes
 * from the API; the page never decides a price or whether an order can be placed.
 */
export function CheckoutPage({ addressId }: { addressId: string | null }) {
  const t = useCheckoutMessages()
  const { status, getAccessToken, signOut } = useAuth()
  const cart = useCart()
  const [view, setView] = useState<View>({ kind: "loading" })
  const [failure, setFailure] = useState<CheckoutFailure | null>(null)
  const [pending, setPending] = useState(false)
  const [chosenAddress, setChosenAddress] = useState(addressId)
  // Coming back from the address list with another choice reuses this page.
  const [linkedAddress, setLinkedAddress] = useState(addressId)
  if (addressId !== linkedAddress) {
    setLinkedAddress(addressId)
    setChosenAddress(addressId)
  }
  // One key per attempt the customer starts, kept only while its outcome is unknown.
  const attemptKey = useRef<string | null>(null)
  // Moves on when the session ends, so answers to the previous account's requests are dropped.
  const account = useRef(0)

  const send = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<{ token: false } | { token: true; result: ApiResult<T> }> => {
      const token = await getAccessToken()
      if (token === null) return { token: false }
      return { token: true, result: await apiRequest<T>(path, token, init) }
    },
    [getAccessToken]
  )

  const showSummary = useCallback(
    (outcome: SummaryOutcome) => {
      if (outcome.state === "ok") setView({ kind: "ready", summary: outcome.summary })
      else if (outcome.state === "not-bootstrapped") setView({ kind: "needs-setup" })
      else if (outcome.state === "signed-out") void signOut()
      else setView({ kind: "failed", failure: outcome.failure })
    },
    [signOut]
  )

  /** Shows a summary answer. A chosen address that no longer exists falls back to the default one. */
  const applySummary = useCallback(
    (result: ApiResult<CheckoutSummary>, address: string | null) => {
      const outcome = interpretSummaryResult(result)
      if (outcome.state === "failed" && outcome.failure === "address-not-found" && address !== null) setChosenAddress(null)
      else showSummary(outcome)
    },
    [showSummary]
  )

  const load = useCallback(
    async (address: string | null) => {
      const started = account.current
      const sent = await send<CheckoutSummary>(summaryPath(address))
      if (started === account.current && sent.token) applySummary(sent.result, address)
    },
    [send, applySummary]
  )

  useEffect(() => {
    if (status !== "signed-in") return
    const started = account.current
    void send<CheckoutSummary>(summaryPath(chosenAddress)).then((sent) => {
      if (started === account.current && sent.token) applySummary(sent.result, chosenAddress)
    })
    return () => {
      account.current += 1
      attemptKey.current = null
      setView({ kind: "loading" })
      setFailure(null)
    }
  }, [status, chosenAddress, send, applySummary])

  async function place(recipientName: string) {
    if (view.kind !== "ready" || pending) return
    const body = placementBody(view.summary, recipientName)
    if (body === null) return
    const started = account.current
    attemptKey.current ??= newIdempotencyKey()
    setPending(true)
    setFailure(null)
    let outcome: PlacementOutcome
    try {
      const { path, init } = placementRequest(body, attemptKey.current)
      const sent = await send<CustomerOrder>(path, init)
      outcome = sent.token ? interpretPlacementResult(sent.result) : { state: "signed-out" }
    } finally {
      setPending(false)
    }
    if (started !== account.current) return
    if (outcome.state === "placed") {
      attemptKey.current = null
      setView({ kind: "placed", order: outcome.order })
      // The ordered lines are gone: the header count and cart follow the server.
      void cart.reload()
      return
    }
    if (outcome.state === "signed-out") return void signOut()
    if (outcome.state === "not-bootstrapped") return setView({ kind: "needs-setup" })
    if (!keepsAttemptKey(outcome.failure)) attemptKey.current = null
    setFailure(outcome.failure)
    if (outcome.failure === "address-not-found" && chosenAddress !== null) setChosenAddress(null)
    else if (needsFreshSummary(outcome.failure)) await load(chosenAddress)
  }

  let body
  if (status === "loading" || (status === "signed-in" && view.kind === "loading")) {
    body = <FormMessage tone="info">{t.loading}</FormMessage>
  } else if (status !== "signed-in") {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="type-title-medium">{t.guestTitle}</p>
        <p className="type-body-medium text-muted-foreground">{t.guestBody}</p>
        <div className="flex flex-wrap gap-2">
          <Link href="/login" className={buttonVariants()}>
            {t.login}
          </Link>
          <Link href="/register" className={buttonVariants({ variant: "outline" })}>
            {t.register}
          </Link>
        </div>
      </div>
    )
  } else if (view.kind === "needs-setup") {
    body = (
      <div className="flex flex-col items-start gap-3">
        <p className="type-body-medium">{t.setupBody}</p>
        <Link href="/account" className={buttonVariants()}>
          {t.setupAction}
        </Link>
      </div>
    )
  } else if (view.kind === "failed") {
    body = (
      <div className="flex flex-col items-start gap-3">
        <FormMessage tone="error">{t.failures[view.failure]}</FormMessage>
        <Button
          variant="outline"
          onClick={() => {
            setView({ kind: "loading" })
            void load(chosenAddress)
          }}
        >
          {t.retry}
        </Button>
      </div>
    )
  } else if (view.kind === "placed") {
    body = <Confirmation order={view.order} t={t} />
  } else if (view.kind === "ready") {
    const { summary } = view
    body = (
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_22rem] md:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Problems summary={summary} t={t} />
          <AddressSection summary={summary} t={t} />
          {summary.shops.map((group) => (
            <ShopSection key={group.shop.id} group={group} t={t} />
          ))}
          <PaymentSection t={t} />
        </div>
        <div className="md:sticky md:top-32">
          {/* Keyed by the default name, so a fresh summary for another account never keeps the previous name. */}
          <SummaryForm key={summary.defaultRecipientName} summary={summary} failure={failure} pending={pending} onPlace={(name) => void place(name)} t={t} />
        </div>
      </div>
    )
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="type-headline-large">{t.title}</h1>
        {view.kind === "placed" ? null : (
          <Link href="/cart" className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t.backToCart}
          </Link>
        )}
      </div>
      {body}
    </main>
  )
}
