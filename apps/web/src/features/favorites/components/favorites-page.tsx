"use client"

import type { FavoriteItem } from "@chicman/shared"
import { ImageOff, Trash2 } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { canOpenFavorite, type FavoriteFailure } from "../favorites-logic"
import { useFavorites } from "../favorites-provider"
import { useFavoriteMessages, type FavoriteMessages } from "../messages"

function FavoriteImage({ item }: { item: FavoriteItem }) {
  if (item.imageUrl === null) {
    return (
      <span className="flex size-full items-center justify-center text-muted-foreground">
        <ImageOff aria-hidden className="size-icon-action" />
      </span>
    )
  }
  // eslint-disable-next-line @next/next/no-img-element -- verified media URL, already normalized by the server
  return <img src={item.imageUrl} alt="" loading="lazy" className="size-full object-cover" />
}

function StateBadge({ item, t }: { item: FavoriteItem; t: FavoriteMessages }) {
  if (item.state === "AVAILABLE") return <Badge variant="success">{t.available}</Badge>
  return <Badge variant="destructive">{item.state === "SOLD_OUT" ? t.soldOut : t.unavailable}</Badge>
}

/**
 * One favorite. A product that is no longer public shows no price, no shop, and
 * no link (spec 14): only its name, its image, and the way to remove it.
 */
function FavoriteRow({ item, onFailure, t }: { item: FavoriteItem; onFailure: (failure: FavoriteFailure | null) => void; t: FavoriteMessages }) {
  const locale = useLocale()
  const { remove, pendingIds } = useFavorites()
  const open = canOpenFavorite(item)
  const href = localizedPath(locale, `/products/${item.productId}`)
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <div className="aspect-[3/4] w-20 shrink-0 self-start overflow-hidden rounded-2xl bg-muted sm:w-24">
        {open ? (
          <Link href={href} tabIndex={-1} aria-hidden className="block size-full">
            <FavoriteImage item={item} />
          </Link>
        ) : (
          <FavoriteImage item={item} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {open ? (
          <Link href={href} dir="auto" className="type-title-small hover:underline">
            {item.name}
          </Link>
        ) : (
          <p dir="auto" className="type-title-small text-muted-foreground">
            {item.name}
          </p>
        )}
        {item.product === null ? (
          <p className="type-body-small text-muted-foreground">{t.unavailableNote}</p>
        ) : (
          <>
            <p className="type-body-medium font-semibold">{formatMru(item.product.price, locale)}</p>
            <p className="type-body-small text-muted-foreground">
              {t.soldBy} : <span dir="auto">{item.product.shop.name}</span>
            </p>
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StateBadge item={item} t={t} />
          <Button
            variant="ghost"
            size="sm"
            aria-label={t.remove.replace("{name}", item.name)}
            disabled={pendingIds.has(item.productId)}
            onClick={() => {
              onFailure(null)
              void remove(item.productId).then(onFailure)
            }}
          >
            <Trash2 aria-hidden />
            {t.removeShort}
          </Button>
        </div>
      </div>
    </li>
  )
}

function FavoritesBody({ t }: { t: FavoriteMessages }) {
  const locale = useLocale()
  const { state, reload } = useFavorites()
  const [failure, setFailure] = useState<FavoriteFailure | null>(null)
  switch (state.kind) {
    case "loading":
      return <FormMessage tone="info">{t.loading}</FormMessage>
    case "guest":
      return (
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
    case "needs-setup":
      return (
        <div className="flex flex-col items-start gap-3">
          <p className="type-body-medium">{t.setupBody}</p>
          <Link href="/account" className={buttonVariants()}>
            {t.setupAction}
          </Link>
        </div>
      )
    case "failed":
      return (
        <div className="flex flex-col items-start gap-3">
          <FormMessage tone="error">{t.failures[state.failure]}</FormMessage>
          <Button variant="outline" onClick={() => void reload()}>
            {t.retry}
          </Button>
        </div>
      )
    case "ready":
      if (state.list.items.length === 0) {
        return (
          <div className="flex flex-col items-start gap-3">
            <p className="type-title-medium">{t.empty}</p>
            <p className="type-body-medium text-muted-foreground">{t.emptyHint}</p>
            <Link href={localizedPath(locale, "/products")} className={buttonVariants()}>
              {t.browse}
            </Link>
          </div>
        )
      }
      return (
        <div className="flex flex-col gap-4">
          {failure === null ? null : <FormMessage tone="error">{t.failures[failure]}</FormMessage>}
          <section aria-label={t.title} className="rounded-3xl border border-border bg-surface p-4 sm:p-6">
            <ul className="flex flex-col divide-y divide-border">
              {state.list.items.map((item) => (
                <FavoriteRow key={item.productId} item={item} onFailure={setFailure} t={t} />
              ))}
            </ul>
          </section>
          <p className="type-body-small text-muted-foreground">{t.cartNote}</p>
        </div>
      )
  }
}

/** `/favorites`: the customer's saved products with their current state (spec 14). */
export function FavoritesPage() {
  const t = useFavoriteMessages()
  const { reload, state } = useFavorites()
  const signedIn = state.kind !== "guest" && state.kind !== "loading"

  // Opening the page reads the list again, so prices and availability are current.
  useEffect(() => {
    if (signedIn) void reload()
    // Only when the page opens or the customer signs in, not after each change.
  }, [signedIn, reload])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <h1 className="type-headline-large">{t.title}</h1>
      <FavoritesBody t={t} />
    </main>
  )
}
