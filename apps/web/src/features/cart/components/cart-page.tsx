"use client"

import type { Cart, CartItem, CartShopGroup } from "@chicman/shared"
import { ImageOff, Minus, Plus, Store, Trash2, TriangleAlert } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Button, buttonVariants } from "@/components/ui/button"
import { FormMessage } from "@/features/auth/components/form-field"
import { localizedPath } from "@/lib/locale"
import { useLocale } from "@/lib/locale-provider"
import { formatMru } from "@/lib/money"

import { canOpenProduct, hasExcludedItems, priceToAccept, quantityControls, type CartFailure } from "../cart-logic"
import { useCart } from "../cart-provider"
import { issueText, useCartMessages, type CartMessages } from "../messages"

/** Runs one change at a time and remembers the failure to show. */
type Act = (itemId: string, change: () => Promise<CartFailure | null>) => void

function ItemImage({ item }: { item: CartItem }) {
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

function QuantityStepper({ item, disabled, act, t }: { item: CartItem; disabled: boolean; act: Act; t: CartMessages }) {
  const { setQuantity } = useCart()
  const { decreaseTo, increaseTo } = quantityControls(item)
  const goTo = (quantity: number) => act(item.id, () => setQuantity(item.id, quantity))
  return (
    <div role="group" aria-label={t.quantity} className="flex items-center gap-1">
      <Button
        variant="outline"
        size="icon"
        aria-label={t.decrease.replace("{name}", item.name)}
        disabled={disabled || decreaseTo === null}
        onClick={() => decreaseTo !== null && goTo(decreaseTo)}
      >
        <Minus aria-hidden className="size-icon-inline" />
      </Button>
      <output className="min-w-8 text-center type-title-small">{item.quantity}</output>
      <Button
        variant="outline"
        size="icon"
        aria-label={t.increase.replace("{name}", item.name)}
        disabled={disabled || increaseTo === null}
        onClick={() => increaseTo !== null && goTo(increaseTo)}
      >
        <Plus aria-hidden className="size-icon-inline" />
      </Button>
    </div>
  )
}

function ItemWarnings({ item, disabled, act, t }: { item: CartItem; disabled: boolean; act: Act; t: CartMessages }) {
  const locale = useLocale()
  const { setQuantity, acceptPrice } = useCart()
  const { correctTo } = quantityControls(item)
  const price = priceToAccept(item)
  if (item.issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {item.issues.map((issue) => (
        <li key={issue.code} className="flex flex-col items-start gap-2 rounded-2xl bg-warning/15 p-3 type-body-small text-warning-text">
          <span className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-icon-inline shrink-0" />
            {issueText(issue, item.unitPrice, t, locale)}
          </span>
          {issue.code === "INSUFFICIENT_STOCK" && correctTo !== null ? (
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => act(item.id, () => setQuantity(item.id, correctTo))}>
              {t.correctQuantity.replace("{count}", String(correctTo))}
            </Button>
          ) : null}
          {issue.code === "PRICE_CHANGED" && price !== null ? (
            <Button variant="outline" size="sm" disabled={disabled} onClick={() => act(item.id, () => acceptPrice(item.id, price))}>
              {t.acceptPrice}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function CartLine({ item, disabled, act, t }: { item: CartItem; disabled: boolean; act: Act; t: CartMessages }) {
  const locale = useLocale()
  const { removeItem } = useCart()
  const href = localizedPath(locale, `/products/${item.productId}`)
  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <div className="aspect-[3/4] w-20 shrink-0 self-start overflow-hidden rounded-2xl bg-muted sm:w-24">
        {canOpenProduct(item) ? (
          <Link href={href} tabIndex={-1} aria-hidden className="block size-full">
            <ItemImage item={item} />
          </Link>
        ) : (
          <ItemImage item={item} />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-col gap-1">
          {canOpenProduct(item) ? (
            <Link href={href} dir="auto" className="type-title-small hover:underline">
              {item.name}
            </Link>
          ) : (
            <p dir="auto" className="type-title-small">
              {item.name}
            </p>
          )}
          {item.size === null ? null : (
            <p className="type-body-small text-muted-foreground">
              {t.size} : <span dir="auto">{item.size}</span>
            </p>
          )}
          {item.color === null ? null : (
            <p className="type-body-small text-muted-foreground">
              {t.color} : <span dir="auto">{item.color}</span>
            </p>
          )}
          <p className="type-body-small text-muted-foreground">
            {t.unitPrice} : {formatMru(item.unitPrice, locale)}
          </p>
        </div>
        <ItemWarnings item={item} disabled={disabled} act={act} t={t} />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <QuantityStepper item={item} disabled={disabled} act={act} t={t} />
          <Button variant="ghost" size="sm" aria-label={t.removeItem.replace("{name}", item.name)} disabled={disabled} onClick={() => act(item.id, () => removeItem(item.id))}>
            <Trash2 aria-hidden />
            {t.remove}
          </Button>
        </div>
        <p className={item.purchasable ? "type-title-small" : "type-title-small text-muted-foreground line-through"}>
          <span className="sr-only">{t.itemSubtotal} : </span>
          {formatMru(item.subtotal, locale)}
        </p>
      </div>
    </li>
  )
}

function ShopGroup({ group, pendingId, act, t }: { group: CartShopGroup; pendingId: string | null; act: Act; t: CartMessages }) {
  const locale = useLocale()
  return (
    <section aria-label={group.shop.name} className="flex flex-col gap-4 rounded-3xl border border-border bg-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-2 type-title-medium">
        <Store aria-hidden className="size-icon-action shrink-0 text-muted-foreground" />
        <span className="sr-only">{t.soldBy} : </span>
        <span dir="auto" className="min-w-0 break-words">
          {group.shop.name}
        </span>
      </h2>
      <ul className="flex flex-col divide-y divide-border">
        {group.items.map((item) => (
          <CartLine key={item.id} item={item} disabled={pendingId !== null} act={act} t={t} />
        ))}
      </ul>
      <p className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 type-body-medium">
        <span className="text-muted-foreground">{t.shopSubtotal}</span>
        <span className="type-title-small">{formatMru(group.subtotal, locale)}</span>
      </p>
    </section>
  )
}

function Summary({ cart, t }: { cart: Cart; t: CartMessages }) {
  const locale = useLocale()
  return (
    <aside aria-label={t.summary} className="flex flex-col gap-3 rounded-3xl border border-border bg-surface p-4 sm:p-6 md:sticky md:top-32">
      <h2 className="type-title-medium">{t.summary}</h2>
      <p className="flex flex-wrap items-center justify-between gap-2">
        <span className="type-body-medium text-muted-foreground">{t.cartSubtotal}</span>
        <span className="type-title-large">{formatMru(cart.subtotal, locale)}</span>
      </p>
      {hasExcludedItems(cart) ? <p className="type-body-small text-warning-text">{t.excludedNote}</p> : null}
      <p className="type-body-small text-muted-foreground">{t.commitmentNote}</p>
    </aside>
  )
}

function CartContents({ cart, t }: { cart: Cart; t: CartMessages }) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [failure, setFailure] = useState<CartFailure | null>(null)

  const act: Act = (itemId, change) => {
    setPendingId(itemId)
    setFailure(null)
    void change().then((result) => {
      setFailure(result)
      setPendingId(null)
    })
  }

  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        {failure === null ? null : <FormMessage tone="error">{t.failures[failure]}</FormMessage>}
        {cart.shops.map((group) => (
          <ShopGroup key={group.shop.id} group={group} pendingId={pendingId} act={act} t={t} />
        ))}
      </div>
      <Summary cart={cart} t={t} />
    </div>
  )
}

function CartBody({ t }: { t: CartMessages }) {
  const locale = useLocale()
  const { state, reload } = useCart()
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
      if (state.cart.shops.length === 0) {
        return (
          <div className="flex flex-col items-start gap-3">
            <p className="type-body-medium text-muted-foreground">{t.empty}</p>
            <Link href={localizedPath(locale, "/products")} className={buttonVariants()}>
              {t.browse}
            </Link>
          </div>
        )
      }
      return <CartContents cart={state.cart} t={t} />
  }
}

/** `/cart`: one cart, grouped by shop (spec 09). Prices and warnings come from the API. */
export function CartPage() {
  const t = useCartMessages()
  const { reload, state } = useCart()
  const signedIn = state.kind !== "guest" && state.kind !== "loading"

  // Opening the page reads the cart again, so prices and stock are current.
  useEffect(() => {
    if (signedIn) void reload()
    // Only when the page opens or the customer signs in, not after each change.
  }, [signedIn, reload])

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-page-gutter py-6">
      <h1 className="type-headline-large">{t.title}</h1>
      <CartBody t={t} />
    </main>
  )
}
