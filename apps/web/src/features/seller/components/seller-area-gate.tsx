"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { buttonVariants } from "@/components/ui/button"
import { AccountGate } from "@/features/auth/components/account-gate"
import { FormMessage } from "@/features/auth/components/form-field"

import { useSellerMessages, type SellerMessages } from "../messages"
import { SELLER_AREA_HREF, sellerGate, type SellerAccess, type SellerArea } from "../seller-dashboard"
import { useSellerShop } from "../seller-shop-provider"

/** Shown instead of a page the shop's status does not open. Gives no administrative reason. */
function Restricted({ access, t }: { access: SellerAccess; t: SellerMessages }) {
  const target = access === "SUSPENDED" ? SELLER_AREA_HREF.deliveries : SELLER_AREA_HREF.shop
  return (
    <main className="flex flex-1 flex-col items-center py-6">
      <section aria-labelledby="seller-restricted" className="flex w-full max-w-xl flex-col items-start gap-3 rounded-3xl border border-border bg-surface p-6">
        <h1 id="seller-restricted" className="type-title-large">
          {t.restrictedTitle}
        </h1>
        <p className="type-body-medium text-muted-foreground">{t.restricted[access]}</p>
        <Link href={target} className={buttonVariants()}>
          {t.restrictedAction[access]}
        </Link>
      </section>
    </main>
  )
}

/**
 * A seller page's content, or its restricted state when the shop's status
 * does not open `area` (spec 16). Hiding a page is not the security control:
 * the API refuses every request it does not allow.
 */
export function SellerAreaGate({ area, children }: { area: SellerArea; children: ReactNode }) {
  // Seller accounts only (AT-1); then the shop status decides (spec 16).
  return (
    <AccountGate area="seller">
      <ShopStatusGate area={area}>{children}</ShopStatusGate>
    </AccountGate>
  )
}

function ShopStatusGate({ area, children }: { area: SellerArea; children: ReactNode }) {
  const t = useSellerMessages()
  const { shop } = useSellerShop()
  const gate = sellerGate(area, shop)
  if (gate.kind === "restricted") return <Restricted access={gate.access} t={t} />
  if (gate.kind === "loading") {
    return (
      <main className="flex flex-1 flex-col py-6">
        <FormMessage tone="info">{t.loading}</FormMessage>
      </main>
    )
  }
  return children
}
