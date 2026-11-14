"use client"

import { ShoppingBag, Store, type LucideIcon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Suspense, type ReactNode } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { ThemeSelector } from "@/components/theme/theme-selector"
import { buttonVariants } from "@/components/ui/button"
import { useAccountMessages } from "@/features/auth/account-messages"
import { AccountActions } from "@/features/auth/components/account-actions"
import { LanguageSwitch } from "@/features/storefront/components/language-switch"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { cn } from "@/lib/utils"

import { ADMIN_AREA_HREF, ADMIN_AREAS, adminAreaOf, type AdminArea } from "../admin-dashboard"
import { useAdminMessages } from "../messages"

const AREA_ICON: Record<AdminArea, LucideIcon> = { shops: Store, orders: ShoppingBag }

/**
 * The administrator areas built so far (spec 17): shops (spec 06) and orders
 * (specs 11–13). Users, products, statistics, and categories wait for O4 and O10.
 */
function AdminNav({ active }: { active: AdminArea | null }) {
  const t = useAdminMessages()
  return (
    <nav aria-label={t.navLabel} className="md:sticky md:top-20">
      <ul className="-mx-page-gutter flex gap-2 overflow-x-auto px-page-gutter pb-1 [scrollbar-width:none] md:mx-0 md:flex-col md:gap-1 md:overflow-visible md:px-0">
        {ADMIN_AREAS.map((area) => {
          const Icon = AREA_ICON[area]
          const current = area === active
          return (
            <li key={area} className="shrink-0">
              <Link
                href={ADMIN_AREA_HREF[area]}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-control-sm items-center gap-2 rounded-full px-4 type-label-large whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 md:h-control",
                  current ? "bg-chip-active text-chip-active-foreground" : "bg-chip-inactive text-chip-inactive-foreground hover:bg-muted md:bg-transparent"
                )}
              >
                <Icon aria-hidden className="size-icon-action shrink-0" />
                <span>{t.nav[area]}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Reads the URL, so it sits in its own Suspense boundary. */
function CurrentAdminNav() {
  return <AdminNav active={adminAreaOf(usePathname())} />
}

/**
 * The administrator area's layout (AT-1, spec 17): header with the profile and
 * sign-out, the area navigation, and the page. No notification bell:
 * administrators have no inbox (O6.1). Pages gate themselves with
 * `AccountGate area="admin"`; the API refuses every administrative request
 * from anyone else.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useAccountMessages()
  const locale = useLocale()
  return (
    <div className="flex flex-1 flex-col bg-page">
      <header className="z-20 border-b border-border bg-surface md:sticky md:top-0">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-page-gutter py-3">
          <div className="flex items-center gap-3">
            <Link href={ADMIN_AREA_HREF.shops} aria-label={t.adminArea} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <BrandLogo label={t.brand} />
            </Link>
            <span className="type-title-small text-muted-foreground">{t.adminArea}</span>
          </div>
          <div className="order-last basis-full sm:order-0 sm:ms-auto sm:basis-auto">
            <ThemeSelector />
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <Link href={localizedPath(locale, "/")} aria-label={t.storefrontLink} title={t.storefrontLink} className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
              <Store aria-hidden className="size-icon-action" />
            </Link>
            <AccountActions />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 px-page-gutter pt-4 md:flex-row md:gap-6 md:pt-6">
        <aside className="md:w-56 md:shrink-0">
          <Suspense fallback={<AdminNav active={null} />}>
            <CurrentAdminNav />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
    </div>
  )
}
