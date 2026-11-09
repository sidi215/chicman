"use client"

import { ShoppingBag } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

import { cartBadge } from "../cart-logic"
import { useCart } from "../cart-provider"
import { useCartMessages } from "../messages"

/** The header's cart icon. Guests see it too: the cart page invites them to sign in. */
export function CartLink() {
  const t = useCartMessages()
  const { itemCount } = useCart()
  return (
    <Link
      href="/cart"
      aria-label={itemCount > 0 ? t.cartLinkWithCount.replace("{count}", String(itemCount)) : t.cartLink}
      className={buttonVariants({ variant: "outline", size: "icon-sm", className: "relative" })}
    >
      <ShoppingBag aria-hidden className="size-icon-action" />
      {itemCount > 0 ? (
        <span aria-hidden className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 type-label-medium text-primary-foreground">
          {cartBadge(itemCount)}
        </span>
      ) : null}
    </Link>
  )
}
