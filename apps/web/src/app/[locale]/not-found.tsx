"use client"

import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"
import { useStorefrontMessages } from "@/features/storefront/messages"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"

export default function NotFound() {
  const t = useStorefrontMessages()
  const locale = useLocale()
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-page px-page-gutter py-10 text-center">
      <h1 className="type-headline-medium">{t.pageNotFoundTitle}</h1>
      <p className="type-body-medium text-muted-foreground">{t.pageNotFoundBody}</p>
      <Link href={localizedPath(locale, "/")} className={buttonVariants({ variant: "outline" })}>
        {t.home}
      </Link>
    </main>
  )
}
