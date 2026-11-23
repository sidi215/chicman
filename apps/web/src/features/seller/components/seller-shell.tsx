"use client"

import { Bell, LayoutDashboard, Package, ShoppingBag, Store, Truck, UserRound, Wallet, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense, useEffect, useRef, type ReactNode } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { buttonVariants } from "@/components/ui/button"
import { SignOutAction } from "@/features/auth/components/account-actions"
import { NotificationsLink } from "@/features/notifications/components/notifications-link"
import { unreadBadge } from "@/features/notifications/notifications-logic"
import { useNotifications } from "@/features/notifications/notifications-provider"
import { useLocale } from "@/lib/locale-provider"
import { localizedPath } from "@/lib/locale"
import { cn } from "@/lib/utils"

import { useSellerMessages, type SellerMessages } from "../messages"
import { SELLER_AREA_HREF, sellerAccess, sellerAreaOf, sellerAreas, type SellerAccess, type SellerArea } from "../seller-dashboard"
import { useSellerShop } from "../seller-shop-provider"

const AREA_ICON: Record<SellerArea, LucideIcon> = {
  overview: LayoutDashboard,
  shop: Store,
  products: Package,
  orders: ShoppingBag,
  deliveries: Truck,
  payments: Wallet,
  notifications: Bell,
  profile: UserRound,
}

/** The areas the shop's status opens; only the overview and the shop page until the status is known. */
function SellerNav({ access, active, t }: { access: SellerAccess | null; active: SellerArea | null; t: SellerMessages }) {
  const { unread } = useNotifications()
  const areas = access === null ? (["overview", "shop", "notifications", "profile"] as const) : sellerAreas(access)
  return (
    <nav aria-label={t.navLabel} className="md:sticky md:top-4">
      <ul className="-mx-page-gutter flex gap-2 overflow-x-auto px-page-gutter pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0">
        {areas.map((area) => {
          const Icon = AREA_ICON[area]
          const current = area === active
          return (
            <li key={area} className="shrink-0">
              <Link
                href={SELLER_AREA_HREF[area]}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-control-sm items-center gap-2 rounded-full px-4 type-label-large whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-control",
                  current ? "bg-chip-active text-chip-active-foreground" : "bg-chip-inactive text-chip-inactive-foreground hover:bg-muted md:bg-transparent"
                )}
              >
                <Icon aria-hidden className="size-icon-action shrink-0" />
                <span>{t.nav[area]}</span>
                {area === "notifications" && unread > 0 ? (
                  <span className="ms-auto rounded-full bg-primary px-1.5 type-label-medium text-primary-foreground">{unreadBadge(unread)}</span>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function SellerHeader({ t }: { t: SellerMessages }) {
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
          navigation's Profile page (`/account/profile`) holds all three,
          as in the buyer and administrator areas.
        */}
        <div className="flex items-center gap-2">
          <Link href={localizedPath(locale, "/")} aria-label={t.storefront} title={t.storefront} className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
            <Store aria-hidden className="size-icon-action" />
          </Link>
          <NotificationsLink href={SELLER_AREA_HREF.notifications} />
          <SignOutAction />
        </div>
      </div>
    </header>
  )
}

/** Reads the URL, so it sits in its own Suspense boundary (as the storefront's category links do). */
function CurrentSellerNav({ t }: { t: SellerMessages }) {
  const pathname = usePathname()
  const { shop, refresh } = useSellerShop()
  const firstPath = useRef(pathname)
  // A status changed elsewhere (approval, suspension) shows on the next page.
  useEffect(() => {
    if (pathname === firstPath.current) return
    firstPath.current = pathname
    void refresh()
  }, [pathname, refresh])
  return <SellerNav access={sellerAccess(shop)} active={sellerAreaOf(pathname)} t={t} />
}

function StatusSellerNav({ t }: { t: SellerMessages }) {
  const { shop } = useSellerShop()
  return <SellerNav access={sellerAccess(shop)} active={null} t={t} />
}

/**
 * The seller area's layout (spec 16): header, the navigation the shop status
 * allows, and the page. Pages a status can close wrap their content in
 * `SellerAreaGate`; the API still refuses every request it does not allow.
 */
export function SellerShell({ children }: { children: ReactNode }) {
  const t = useSellerMessages()
  return (
    <div className="flex flex-1 flex-col bg-page">
      <SellerHeader t={t} />
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-page-gutter pt-4 md:flex-row md:gap-6 md:pt-6">
        <aside className="md:w-60 md:shrink-0">
          <Suspense fallback={<StatusSellerNav t={t} />}>
            <CurrentSellerNav t={t} />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
