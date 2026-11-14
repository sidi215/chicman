"use client"

import { Store } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"

import { BrandLogo } from "@/components/brand/brand-logo"
import { ThemeSelector } from "@/components/theme/theme-selector"
import { buttonVariants } from "@/components/ui/button"
import { useAccountMessages } from "@/features/auth/account-messages"
import { AccountActions } from "@/features/auth/components/account-actions"
import { LanguageSwitch } from "@/features/storefront/components/language-switch"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

/**
 * The administrator area's layout (AT-1; start of spec 17): header with the
 * profile and sign-out, and the page. No notification bell: administrators
 * have no inbox (O6.1). Pages gate themselves with `AccountGate area="admin"`;
 * the API refuses every administrative request from anyone else.
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const t = useAccountMessages()
  const locale = useLocale()
  return (
    <div className="flex flex-1 flex-col bg-page">
      <header className="z-20 border-b border-border bg-surface md:sticky md:top-0">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-page-gutter py-3">
          <div className="flex items-center gap-3">
            <Link href="/admin/shops" aria-label={t.adminArea} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
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
      {children}
    </div>
  )
}
