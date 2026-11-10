"use client"

import type { CustomerOrderItem, ShopOrderLabel, ShopOrderReasonCode } from "@chicman/shared"
import { ImageOff } from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, type ComponentProps } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-provider"
import { apiRequest } from "@/lib/api-client"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import type { OrderMessages } from "../messages"
import { interpretOrderResult, type DecisionText, type OrderOutcome } from "../order-logic"

/** An answer that arrived after the account changed: dropped, never shown. */
export type GuardedOutcome<T> = OrderOutcome<T> | { state: "stale" }

/**
 * Authenticated calls to the order API. Guests go to the login page. As in the
 * cart provider, an answer to a request made for a previous account is
 * dropped, so one account's orders never show to the next.
 */
export function useOrderApi() {
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  // Moves on whenever the session changes.
  const account = useRef(0)

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
    return () => {
      account.current += 1
    }
  }, [status, router])

  const call = useCallback(
    async <T,>(path: string, method = "GET", body?: unknown): Promise<GuardedOutcome<T>> => {
      const started = account.current
      const token = await getAccessToken()
      if (!token) return { state: "signed-out" }
      const result = await apiRequest<T>(path, token, {
        method,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
      })
      if (started !== account.current) return { state: "stale" }
      const outcome = interpretOrderResult(result)
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )

  return { status, call }
}

const LABEL_VARIANT: Record<ShopOrderLabel, ComponentProps<typeof Badge>["variant"]> = {
  AWAITING_SHOP: "warning",
  PREPARING: "highlight",
  READY_FOR_DELIVERY: "highlight",
  OUT_FOR_DELIVERY: "highlight",
  DELIVERY_FAILED_RETRY: "warning",
  DELIVERED: "success",
  UNDELIVERABLE: "destructive",
  REJECTED: "destructive",
  CANCELLED: "secondary",
  EXPIRED: "secondary",
}

export function LabelBadge({ label, t }: { label: ShopOrderLabel; t: OrderMessages }) {
  return <Badge variant={LABEL_VARIANT[label]}>{t.labels[label]}</Badge>
}

export function Thumbnail({ url }: { url: string | null }) {
  return (
    <div className="aspect-[3/4] w-14 shrink-0 self-start overflow-hidden rounded-2xl bg-muted">
      {url === null ? (
        <span className="flex size-full items-center justify-center text-muted-foreground">
          <ImageOff aria-hidden className="size-icon-inline" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- the image at placement (S2-7), already normalized by the server
        <img
          src={url}
          alt=""
          loading="lazy"
          className="size-full object-cover"
          // A missing object shows the placeholder instead (S2-7).
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden"
          }}
        />
      )}
    </div>
  )
}

export function AmountRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <p className="flex flex-wrap items-center justify-between gap-2">
      <span className="type-body-medium text-muted-foreground">{label}</span>
      <span className={strong ? "type-title-large" : "type-title-small"}>{value}</span>
    </p>
  )
}

export function feeText(fee: string, t: OrderMessages, locale: ReturnType<typeof useLocale>): string {
  return fee === "0.00" ? t.freeDelivery : formatMru(fee, locale)
}

/** The snapshotted items: name, variant, quantity, unit price, line total, and the image at placement. */
export function ItemList({ items, t }: { items: readonly CustomerOrderItem[]; t: OrderMessages }) {
  const locale = useLocale()
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <Thumbnail url={item.imageUrl} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p dir="auto" className="type-title-small break-words">
              {item.productName}
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
          <p className="shrink-0 type-title-small">{formatMru(item.lineTotal, locale)}</p>
        </li>
      ))}
    </ul>
  )
}

/** A decision, translated. Free text (a customer's explanation, seller side only) is rendered as text, never as markup. */
export function DecisionLine({ decision, t }: { decision: DecisionText; t: OrderMessages }) {
  if (decision === null) return null
  const reason = (code: ShopOrderReasonCode): string => t.reasonPrefix.replace("{reason}", t.reasons[code])
  switch (decision.kind) {
    case "chicman":
      return <p className="type-body-medium">{t.cancelledByChicman}</p>
    case "reason":
      return <p className="type-body-medium">{reason(decision.code)}</p>
    case "by-seller":
      return (
        <div className="flex flex-col gap-1">
          <p className="type-body-medium">{t.cancelledBySeller}</p>
          {decision.code === null ? null : <p className="type-body-small text-muted-foreground">{reason(decision.code)}</p>}
        </div>
      )
    case "by-customer":
      return (
        <div className="flex flex-col gap-1">
          <p className="type-body-medium">{t.cancelledByCustomer}</p>
          {decision.code === null ? null : <p className="type-body-small text-muted-foreground">{reason(decision.code)}</p>}
          {decision.text === null ? null : (
            <p dir="auto" className="type-body-small break-words whitespace-pre-wrap text-muted-foreground">
              {t.customerText.replace("{text}", decision.text)}
            </p>
          )}
        </div>
      )
  }
}

export function Pagination({ page, pages, onPage, t }: { page: number; pages: number; onPage: (page: number) => void; t: OrderMessages }) {
  if (pages <= 1) return null
  return (
    <nav className="flex items-center justify-between gap-3">
      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t.previousPage}
      </Button>
      <span className="type-body-small text-muted-foreground">{t.pageOf.replace("{page}", String(page)).replace("{pages}", String(pages))}</span>
      <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        {t.nextPage}
      </Button>
    </nav>
  )
}
