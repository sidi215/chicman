"use client"

import { PRODUCT_CATEGORIES, type ProductCategory } from "@chicman/shared"
import { UserRound } from "lucide-react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { ThemeSelector } from "@/components/theme/theme-selector"
import { buttonVariants } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-provider"
import { CartLink } from "@/features/cart/components/cart-link"
import { FavoritesLink } from "@/features/favorites/components/favorites-link"
import { NotificationsLink } from "@/features/notifications/components/notifications-link"
import { NOTIFICATIONS_HREF } from "@/features/notifications/notifications-logic"
import { localizedPath, withoutLocale } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { cn } from "@/lib/utils"

import { filtersFromParams, listingHref, NO_FILTERS } from "../catalog-query"
import { useStorefrontMessages } from "../messages"
import { LanguageSwitch } from "./language-switch"

function CategoryLink({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex h-control-sm shrink-0 items-center justify-center rounded-full px-4 type-label-large whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "bg-chip-active text-chip-active-foreground" : "bg-chip-inactive text-chip-inactive-foreground hover:bg-muted"
      )}
    >
      {children}
    </Link>
  )
}

function CategoryLinks({ active }: { active: ProductCategory | "all" | null }) {
  const t = useStorefrontMessages()
  const locale = useLocale()
  return (
    <nav aria-label={t.categoriesLabel} className="-mx-page-gutter flex gap-2 overflow-x-auto px-page-gutter [scrollbar-width:none]">
      <CategoryLink href={localizedPath(locale, listingHref(NO_FILTERS))} active={active === "all"}>
        {t.allProducts}
      </CategoryLink>
      {PRODUCT_CATEGORIES.map((category) => (
        <CategoryLink key={category} href={localizedPath(locale, listingHref({ ...NO_FILTERS, category }))} active={active === category}>
          {t.categories[category]}
        </CategoryLink>
      ))}
    </nav>
  )
}

/** Reads the URL, so it sits in its own Suspense boundary and the header stays prerendered. */
function CurrentCategoryLinks() {
  const pathname = usePathname()
  const params = useSearchParams()
  if (withoutLocale(pathname) !== "/products") return <CategoryLinks active={null} />
  return <CategoryLinks active={filtersFromParams(params).category ?? "all"} />
}

/** Guests can browse everything: the account is only offered, never required. */
function AccountAction() {
  const t = useStorefrontMessages()
  const { status } = useAuth()
  if (status === "signed-in") {
    return (
      <Link href="/account" className={buttonVariants({ variant: "outline", size: "sm" })}>
        <UserRound aria-hidden />
        {t.account}
      </Link>
    )
  }
  return (
    <>
      <Link href="/register" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "hidden sm:inline-flex")}>
        {t.register}
      </Link>
      <Link href="/login" className={buttonVariants({ size: "sm" })}>
        {t.login}
      </Link>
    </>
  )
}

export function StorefrontHeader() {
  const t = useStorefrontMessages()
  const locale = useLocale()
  return (
    // Sticky only where the header leaves room for the products.
    <header className="z-20 border-b border-border bg-surface md:sticky md:top-0">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-page-gutter py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <Link href={localizedPath(locale, "/")} aria-label={t.home} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <BrandLogo label={t.brand} />
          </Link>
          <div className="order-last basis-full sm:order-0 sm:ms-auto sm:basis-auto">
            <ThemeSelector />
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <NotificationsLink href={NOTIFICATIONS_HREF} />
            <FavoritesLink />
            <CartLink />
            <AccountAction />
          </div>
        </div>
        <Suspense fallback={<CategoryLinks active={null} />}>
          <CurrentCategoryLinks />
        </Suspense>
      </div>
    </header>
  )
}
