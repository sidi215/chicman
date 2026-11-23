"use client"

import { Bell, Heart, LayoutDashboard, MapPin, Package, Store, UserRound, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense, type ReactNode } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { InDashboard } from "@/components/layout/in-dashboard"
import { buttonVariants } from "@/components/ui/button"
import { useAccount } from "@/features/auth/account-provider"
import { SignOutAction } from "@/features/auth/components/account-actions"
import { CartLink } from "@/features/cart/components/cart-link"
import { favoritesBadge } from "@/features/favorites/favorites-logic"
import { useFavorites } from "@/features/favorites/favorites-provider"
import { NotificationsLink } from "@/features/notifications/components/notifications-link"
import { unreadBadge } from "@/features/notifications/notifications-logic"
import { useNotifications } from "@/features/notifications/notifications-provider"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { cn } from "@/lib/utils"

import { BUYER_AREA_HREF, BUYER_AREAS, buyerAreaOf, showsBuyerShell, type BuyerArea } from "../buyer-dashboard"
import { useBuyerMessages, type BuyerMessages } from "../messages"

const AREA_ICON: Record<BuyerArea, LucideIcon> = {
  overview: LayoutDashboard,
  orders: Package,
  favorites: Heart,
  addresses: MapPin,
  notifications: Bell,
  profile: UserRound,
}

/** The count shown beside an area, if any: unread notifications and saved favorites. */
function useAreaCounts(): Partial<Record<BuyerArea, string>> {
  const { unread } = useNotifications()
  const { count } = useFavorites()
  return {
    ...(unread > 0 ? { notifications: unreadBadge(unread) } : {}),
    ...(count > 0 ? { favorites: favoritesBadge(count) } : {}),
  }
}

function BuyerNav({ active, t }: { active: BuyerArea | null; t: BuyerMessages }) {
  const counts = useAreaCounts()
  return (
    <nav aria-label={t.navLabel} className="md:sticky md:top-20">
      <ul className="-mx-page-gutter flex gap-2 overflow-x-auto px-page-gutter pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0">
        {BUYER_AREAS.map((area) => {
          const Icon = AREA_ICON[area]
          const current = area === active
          const count = counts[area]
          return (
            <li key={area} className="shrink-0">
              <Link
                href={BUYER_AREA_HREF[area]}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-control-sm items-center gap-2 rounded-full px-4 type-label-large whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-control",
                  current ? "bg-chip-active text-chip-active-foreground" : "bg-chip-inactive text-chip-inactive-foreground hover:bg-muted md:bg-transparent"
                )}
              >
                <Icon aria-hidden className="size-icon-action shrink-0" />
                <span>{t.nav[area]}</span>
                {count === undefined ? null : (
                  <span className="ms-auto rounded-full bg-primary px-1.5 type-label-medium text-primary-foreground">{count}</span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Reads the URL, so it sits in its own Suspense boundary (as the seller and admin navigations do). */
function CurrentBuyerNav({ t }: { t: BuyerMessages }) {
  return <BuyerNav active={buyerAreaOf(usePathname())} t={t} />
}

function BuyerHeader({ t }: { t: BuyerMessages }) {
  const locale = useLocale()
  return (
    <header className="z-20 border-b border-border bg-surface md:sticky md:top-0">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-page-gutter py-3">
        <div className="flex items-center gap-3">
          <Link href={localizedPath(locale, "/")} aria-label={t.home} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandLogo label={t.brand} />
          </Link>
          <span className="type-title-small text-muted-foreground">{t.areaTitle}</span>
        </div>
        {/*
          No profile, language, or appearance controls here: the side
          navigation's Profile page (`/account/profile`) holds all three.
        */}
        <div className="flex items-center gap-2">
          <Link href={localizedPath(locale, "/products")} aria-label={t.storefront} title={t.storefront} className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <Store aria-hidden className="size-icon-action" />
          </Link>
          <NotificationsLink href={BUYER_AREA_HREF.notifications} />
          <CartLink />
          <SignOutAction />
        </div>
      </div>
    </header>
  )
}

/** The page alone: account setup, and the shared profile page of a Seller or an Administrator. */
function Bare({ children }: { children: ReactNode }) {
  return <>{children}</>
}

/**
 * The buyer dashboard's layout (`/account`): the same header and side
 * navigation as the seller and administrator areas, around the existing buyer
 * pages. Pages gate themselves with `AccountGate`; the API authorizes every
 * request on its own.
 */
export function BuyerShell({ children }: { children: ReactNode }) {
  const t = useBuyerMessages()
  const { account } = useAccount()
  if (!showsBuyerShell(account)) return <Bare>{children}</Bare>
  return (
    <div className="flex flex-1 flex-col bg-page">
      <BuyerHeader t={t} />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-page-gutter pt-4 md:flex-row md:gap-6 md:pt-6">
        <aside className="md:w-60 md:shrink-0">
          <Suspense fallback={<BuyerNav active={null} t={t} />}>
            <CurrentBuyerNav t={t} />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col pb-10">
          <InDashboard>{children}</InDashboard>
        </div>
      </div>
    </div>
  )
}
