"use client"

import type { AccountProfileResponse, CustomerAddressListResponse, CustomerOrderListResponse } from "@chicman/shared"
import { ChevronRight, MapPin, UserRound } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { dismissAddressPrompt, isAddressPromptDismissed } from "@/features/addresses/address-form"
import { ACCOUNT_PATH } from "@/features/auth/account"
import { useAuth } from "@/features/auth/auth-provider"
import { useAuthMessages } from "@/features/auth/use-auth-messages"
import { FormMessage } from "@/features/auth/components/form-field"
import { useFavorites } from "@/features/favorites/favorites-provider"
import { useNotifications } from "@/features/notifications/notifications-provider"
import { LabelBadge, useOrderApi } from "@/features/orders/components/order-shared"
import { useOrderMessages } from "@/features/orders/messages"
import { accountOrderHref } from "@/features/orders/order-logic"
import { formatDateTime } from "@/lib/date-time"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { addressLine, ADDRESSES_PATH, BUYER_AREA_HREF, defaultAddress, greetingName, openShopOrderCount, RECENT_ORDERS_PATH } from "../buyer-dashboard"
import { useBuyerMessages, type BuyerMessages } from "../messages"

/** `undefined` while loading, `null` when the read failed. */
type Figure<T> = T | null | undefined

interface Overview {
  profile: Figure<AccountProfileResponse>
  orders: Figure<CustomerOrderListResponse>
  addresses: Figure<CustomerAddressListResponse>
}

const LOADING: Overview = { profile: undefined, orders: undefined, addresses: undefined }

/**
 * Reads the existing buyer APIs (accounts, orders, addresses), each on its
 * own, so one failure leaves the others shown. Nothing is worked out here
 * beyond picking from what the API returns.
 */
function useOverview(): { overview: Overview; retry: () => void } {
  const { status, call } = useOrderApi()
  const [overview, setOverview] = useState<Overview>(LOADING)
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    function read<K extends keyof Overview>(key: K, path: string) {
      void call<NonNullable<Overview[K]>>(path).then((outcome) => {
        if (cancelled || outcome.state === "stale" || outcome.state === "signed-out") return
        setOverview((current) => ({ ...current, [key]: outcome.state === "ok" ? outcome.data : null }))
      })
    }
    read("profile", ACCOUNT_PATH)
    read("orders", RECENT_ORDERS_PATH)
    read("addresses", ADDRESSES_PATH)
    return () => {
      cancelled = true
    }
  }, [status, call, reloads])

  return {
    overview,
    retry: () => {
      setOverview(LOADING)
      setReloads((count) => count + 1)
    },
  }
}

function Tile({ title, value, detail, href, t }: { title: string; value: string | undefined | null; detail?: string | undefined; href: string; t: BuyerMessages }) {
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
        <span className="truncate type-headline-small" dir="auto">
          {value ?? t.unknown}
        </span>
      )}
      {detail === undefined ? null : (
        <span className="type-body-small text-muted-foreground" dir="auto">
          {detail}
        </span>
      )}
    </Link>
  )
}

function Summary({ overview, t }: { overview: Overview; t: BuyerMessages }) {
  const { unread } = useNotifications()
  const favorites = useFavorites()
  const { orders, addresses } = overview
  const open = orders === undefined || orders === null ? null : openShopOrderCount(orders.orders)
  const known = addresses === undefined || addresses === null ? null : addresses.addresses
  const chosen = known === null ? null : defaultAddress(known)
  const addressValue = known === null ? (addresses as null | undefined) : chosen === null ? t.tiles.noAddress : chosen.city
  const addressDetail = known === null ? undefined : chosen === null ? t.tiles.addAddress : addressLine(chosen)
  const favoritesValue = favorites.state.kind === "ready" ? String(favorites.count) : favorites.state.kind === "failed" ? null : undefined
  return (
    <section aria-label={t.summaryLabel} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        title={t.tiles.orders}
        value={orders === undefined || orders === null ? orders : String(orders.total)}
        detail={open === null ? undefined : open > 0 ? t.tiles.openOrders.replace("{count}", String(open)) : t.tiles.noOpenOrders}
        href={BUYER_AREA_HREF.orders}
        t={t}
      />
      <Tile title={t.tiles.notifications} value={String(unread)} href={BUYER_AREA_HREF.notifications} t={t} />
      <Tile
        title={t.tiles.favorites}
        value={favoritesValue}
        href={BUYER_AREA_HREF.favorites}
        t={t}
      />
      <Tile
        title={t.tiles.address}
        value={addressValue}
        detail={addressDetail}
        href={BUYER_AREA_HREF.addresses}
        t={t}
      />
    </section>
  )
}

function RecentOrders({ orders, onRetry, t }: { orders: Figure<CustomerOrderListResponse>; onRetry: () => void; t: BuyerMessages }) {
  const locale = useLocale()
  const orderT = useOrderMessages()
  return (
    <section aria-labelledby="recent-orders-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="recent-orders-title" className="type-title-large">
          {t.recentTitle}
        </h2>
        {orders !== undefined && orders !== null && orders.total > 0 ? (
          <Link href={BUYER_AREA_HREF.orders} className={buttonVariants({ variant: "ghost", size: "sm" })}>
            {t.seeAllOrders}
            <ChevronRight aria-hidden className="size-icon-inline rtl:rotate-180" />
          </Link>
        ) : null}
      </div>
      {orders === undefined ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
      {orders === null ? (
        <div className="flex flex-col items-start gap-3">
          <FormMessage tone="error">{t.ordersFailed}</FormMessage>
          <Button variant="outline" onClick={onRetry}>
            {t.retry}
          </Button>
        </div>
      ) : null}
      {orders !== undefined && orders !== null && orders.orders.length === 0 ? (
        <div className="flex flex-col items-start gap-3">
          <p className="type-body-medium text-muted-foreground">{t.noOrders}</p>
          <Link href={localizedPath(locale, "/products")} className={buttonVariants()}>
            {t.startShopping}
          </Link>
        </div>
      ) : null}
      {orders !== undefined && orders !== null && orders.orders.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border">
          {orders.orders.map((order) => (
            <li key={order.id}>
              <Link
                href={accountOrderHref(order.id)}
                aria-label={`${t.openOrder} ${order.reference}`}
                className="-mx-2 flex flex-col gap-2 rounded-2xl px-2 py-3 outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="type-title-small" dir="ltr">
                    {order.reference}
                  </span>
                  <span className="type-title-small">{formatMru(order.total, locale)}</span>
                </span>
                <span className="type-body-small text-muted-foreground">{t.placedOn.replace("{date}", formatDateTime(order.createdAt, locale))}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1">
                  {order.shopOrders.map((shopOrder) => (
                    <span key={shopOrder.id} className="flex items-center gap-2">
                      <span dir="auto" className="type-body-medium">
                        {shopOrder.shopName}
                      </span>
                      <LabelBadge label={shopOrder.label} t={orderT} />
                    </span>
                  ))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function ProfileCard({ profile, t }: { profile: Figure<AccountProfileResponse>; t: BuyerMessages }) {
  const { session } = useAuth()
  // The phone is unverified contact information (spec 04): this label says so.
  const authT = useAuthMessages()
  return (
    <section aria-labelledby="profile-card-title" className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 id="profile-card-title" className="flex items-center gap-2 type-title-large">
        <UserRound aria-hidden className="size-icon-action text-muted-foreground" />
        {t.profileTitle}
      </h2>
      {profile === undefined ? <span aria-hidden className="h-5 w-40 animate-pulse rounded-full bg-muted" /> : null}
      {profile?.profile.fullName ? (
        <p className="type-title-medium" dir="auto">
          {profile.profile.fullName}
        </p>
      ) : null}
      {session?.user.email ? (
        <p className="type-body-medium text-muted-foreground" dir="ltr">
          {session.user.email}
        </p>
      ) : null}
      {profile === undefined || profile === null ? null : (
        <p className="type-body-medium">
          <span className="text-muted-foreground">{authT.contactPhone} : </span>
          {profile.profile.phone === null ? t.noPhone : <span dir="ltr">{profile.profile.phone}</span>}
        </p>
      )}
      <Link href={BUYER_AREA_HREF.profile} className={buttonVariants({ variant: "outline", className: "self-start" })}>
        {t.editProfile}
      </Link>
    </section>
  )
}

/** The prompt shown once a buyer has no address yet, until dismissed on this device (spec 05). */
function AddressPrompt({ addresses, t }: { addresses: Figure<CustomerAddressListResponse>; t: BuyerMessages }) {
  // Rendered only after `AccountGate` has the account, so only in the browser; the guard is for safety.
  const [dismissed, setDismissed] = useState(() => typeof window === "undefined" || isAddressPromptDismissed(window.localStorage))
  if (dismissed || addresses === undefined || addresses === null || addresses.addresses.length > 0) return null
  return (
    <section aria-labelledby="address-prompt-title" className="flex flex-col gap-3 rounded-3xl bg-muted p-4 sm:flex-row sm:items-center sm:p-6">
      <MapPin aria-hidden className="size-icon-navigation shrink-0 text-muted-foreground" />
      <div className="flex flex-1 flex-col gap-1">
        <p id="address-prompt-title" className="type-title-small">
          {t.addressPromptTitle}
        </p>
        <p className="type-body-small text-muted-foreground">{t.addressPromptBody}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/account/addresses/new" className={buttonVariants()}>
          {t.addressPromptAdd}
        </Link>
        <Button
          variant="ghost"
          onClick={() => {
            dismissAddressPrompt(window.localStorage)
            setDismissed(true)
          }}
        >
          {t.addressPromptLater}
        </Button>
      </div>
    </section>
  )
}

/**
 * `/account`: the buyer dashboard's overview. A greeting, the figures from the
 * existing APIs, the latest orders, and the profile. Each part loads and fails
 * on its own.
 */
export function BuyerOverview() {
  const t = useBuyerMessages()
  const { overview, retry } = useOverview()
  const name = greetingName(overview.profile?.profile.fullName)
  return (
    <main className="flex w-full flex-1 flex-col gap-6 py-6">
      <div className="flex flex-col gap-1">
        <h1 className="type-headline-small" dir="auto">
          {name === null ? t.greetingAnonymous : t.greeting.replace("{name}", name)}
        </h1>
        <p className="type-body-medium text-muted-foreground">{t.subtitle}</p>
      </div>
      <AddressPrompt addresses={overview.addresses} t={t} />
      <Summary overview={overview} t={t} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <RecentOrders orders={overview.orders} onRetry={retry} t={t} />
        <ProfileCard profile={overview.profile} t={t} />
      </div>
    </main>
  )
}
