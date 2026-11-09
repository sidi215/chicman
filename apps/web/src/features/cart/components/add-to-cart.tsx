"use client"

import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"

import type { CartFailure } from "../cart-logic"
import { useCart } from "../cart-provider"
import { useCartMessages } from "../messages"

/**
 * Adds one unit to the cart. `purchasable` only decides whether to offer the
 * button: the API validates the product, the variant, and the stock again.
 * Guests are invited to sign in, since a cart belongs to an account.
 */
export function AddToCart({ productId, variantId, purchasable }: { productId: string; variantId: string | undefined; purchasable: boolean }) {
  const t = useCartMessages()
  const { state, addItem } = useCart()
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ added: true } | { failure: CartFailure } | null>(null)

  async function onAdd() {
    setPending(true)
    setResult(null)
    const failure = await addItem({ productId, quantity: 1, ...(variantId === undefined ? {} : { variantId }) })
    setPending(false)
    setResult(failure === null ? { added: true } : { failure })
  }

  if (state.kind === "guest") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="type-body-medium text-muted-foreground">{t.guestAdd}</p>
        <Link href="/login" className={buttonVariants({ size: "lg" })}>
          {t.login}
        </Link>
      </div>
    )
  }
  if (state.kind === "needs-setup") {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="type-body-medium text-muted-foreground">{t.setupBody}</p>
        <Link href="/account" className={buttonVariants({ size: "lg" })}>
          {t.setupAction}
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="lg" disabled={!purchasable || pending || state.kind === "loading"} onClick={() => void onAdd()}>
        {pending ? t.adding : t.add}
      </Button>
      {result !== null && "added" in result ? (
        <p role="status" className="type-body-medium text-success-text">
          {t.added}{" "}
          <Link href="/cart" className="underline underline-offset-4">
            {t.viewCart}
          </Link>
        </p>
      ) : null}
      {result !== null && "failure" in result ? <FormMessage tone="error">{t.failures[result.failure]}</FormMessage> : null}
    </div>
  )
}
