"use client"

import { Heart } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { FavoriteFailure } from "../favorites-logic"
import { useFavorites } from "../favorites-provider"
import { useFavoriteMessages } from "../messages"

/**
 * The heart on a product card or page. It adds or removes a favorite and
 * nothing else: the cart is never touched. Guests are invited to sign in,
 * since favorites belong to an account.
 */
export function FavoriteButton({ productId, name, className }: { productId: string; name: string; className?: string }) {
  const t = useFavoriteMessages()
  const { state, ids, pendingIds, add, remove } = useFavorites()
  const [failure, setFailure] = useState<FavoriteFailure | null>(null)
  const classes = cn(buttonVariants({ variant: "outline", size: "icon-sm" }), "shadow-sm", className)

  if (state.kind === "guest" || state.kind === "needs-setup") {
    return (
      <Link href={state.kind === "guest" ? "/login" : "/account"} aria-label={t.guestAdd.replace("{name}", name)} className={classes}>
        <Heart aria-hidden className="size-icon-inline" />
      </Link>
    )
  }

  const favorite = ids.has(productId)
  async function onToggle() {
    setFailure(null)
    setFailure(await (favorite ? remove(productId) : add(productId)))
  }

  // `className` places the whole control (as for the guest link above), never the inner button alone.
  return (
    <span className={cn("relative inline-flex", className)}>
      <Button
        variant="outline"
        size="icon-sm"
        className="shadow-sm"
        aria-pressed={favorite}
        aria-label={(favorite ? t.remove : t.add).replace("{name}", name)}
        disabled={state.kind !== "ready" || pendingIds.has(productId)}
        onClick={() => void onToggle()}
      >
        <Heart aria-hidden className={cn("size-icon-inline", favorite && "fill-current text-error-text")} />
      </Button>
      {failure === null ? null : (
        <span role="alert" className="absolute end-0 top-full z-10 mt-1 w-48 rounded-2xl bg-surface p-2 type-body-small text-error-text shadow-md">
          {t.failures[failure]}
        </span>
      )}
    </span>
  )
}
