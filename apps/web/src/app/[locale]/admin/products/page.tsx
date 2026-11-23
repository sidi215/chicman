import { Suspense } from "react"

import { shopIdFilter } from "@/features/admin/admin-dashboard"
import { AccountGate } from "@/features/auth/components/account-gate"
import { AdminProductList } from "@/features/moderation/components/admin-moderation"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Produits · Administration · Chicman", ar: "المنتجات · الإدارة · شيكمان" })

async function ProductsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { shopId } = await searchParams
  const initialShopId = shopIdFilter(shopId)
  return (
    <AccountGate area="admin">
      {/* Keyed so a link to another shop's products starts from that shop. */}
      <AdminProductList key={initialShopId ?? "all"} initialShopId={initialShopId} />
    </AccountGate>
  )
}

/** `/admin/products` (spec 19): product inspection, every shop and seller status. */
export default function AdminProductsPage({ searchParams }: PageProps<"/[locale]/admin/products">) {
  return (
    <Suspense>
      <ProductsRoute searchParams={searchParams} />
    </Suspense>
  )
}
