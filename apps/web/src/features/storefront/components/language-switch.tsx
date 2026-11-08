"use client"

import { Languages } from "lucide-react"
import { usePathname } from "next/navigation"
import { Suspense, useEffect, type MouseEvent } from "react"

import { buttonVariants } from "@/components/ui/button"
import { useSaveProfileLocale } from "@/features/profile/use-locale-sync"
import { DEFAULT_LOCALE, LOCALE_COOKIE, localeCookie, localizedPath, switchedHref, type Locale } from "@/lib/locale"
import { goToLocale } from "@/lib/locale-choice"
import { useLocale } from "@/lib/locale-provider"
import { cn } from "@/lib/utils"

const NAMES: Record<Locale, string> = { fr: "Français", ar: "العربية" }

function SwitchLink({ href, target, className }: { href: string; target: Locale; className?: string | undefined }) {
  const saveProfileLocale = useSaveProfileLocale()
  // A full page load: the root layout sets the document's language and direction.
  const choose = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    void saveProfileLocale(target).finally(() => goToLocale(target))
  }
  return (
    <a href={href} hrefLang={target} lang={target} onClick={choose} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), className)}>
      <Languages aria-hidden />
      {NAMES[target]}
    </a>
  )
}

function CurrentPageSwitchLink({ target, className }: { target: Locale; className?: string | undefined }) {
  return <SwitchLink href={switchedHref(usePathname(), "", target)} target={target} className={className} />
}

/** Offers the other language, on the same page. */
export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale()
  const target: Locale = locale === "ar" ? "fr" : "ar"

  // A visitor who arrived on an Arabic URL stays in Arabic on pages without a language in their URL.
  useEffect(() => {
    if (locale === DEFAULT_LOCALE || document.cookie.includes(`${LOCALE_COOKIE}=`)) return
    document.cookie = localeCookie(locale, window.location.protocol === "https:")
  }, [locale])

  return (
    <Suspense fallback={<SwitchLink href={localizedPath(target, "/")} target={target} className={className} />}>
      <CurrentPageSwitchLink target={target} className={className} />
    </Suspense>
  )
}
