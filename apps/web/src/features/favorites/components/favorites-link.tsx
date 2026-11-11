"use client"

import { Heart } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

import { favoritesBadge } from "../favorites-logic"
import { useFavorites } from "../favorites-provider"
import { useFavoriteMessages } from "../messages"

/**
 * The header's favorites icon, with the number of saved products. Guests see
 * the icon too (the page invites them to sign in), never a count. The count is
 * the provider's list, so every heart and the favorites page update it at once.
 */
export function FavoritesLink() {
  const t = useFavoriteMessages()
  const { count } = useFavorites()
  return (
    <Link
      href="/favorites"
      aria-label={count > 0 ? t.linkWithCount.replace("{count}", String(count)) : t.link}
      className={buttonVariants({ variant: "outline", size: "icon-sm", className: "relative" })}
    >
      <Heart aria-hidden className="size-icon-action" />
      {count > 0 ? (
        <span
          aria-hidden
          data-testid="favorites-count"
          // The cart badge's exact classes (`CartLink`), so both header counters look and sit the same.
          className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 type-label-medium text-primary-foreground"
        >
          {favoritesBadge(count)}
        </span>
      ) : null}
    </Link>
  )
}
