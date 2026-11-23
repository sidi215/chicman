import { Suspense } from "react"

import { sellerModerationFilter } from "@/features/moderation/moderation"
import { ProductList } from "@/features/products/components/product-list"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes produits · Chicman", ar: "منتجاتي · شيكمان" })

async function ProductsRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { moderation } = await searchParams
  const initial = sellerModerationFilter(moderation)
  return (
    <SellerAreaGate area="products">
      {/* Keyed so the overview's link always starts from its filter (spec 19). */}
      <ProductList key={initial ?? "all"} initialModeration={initial} />
    </SellerAreaGate>
  )
}

export default function SellerProductsPage({ searchParams }: PageProps<"/[locale]/seller/products">) {
  return (
    <Suspense>
      <ProductsRoute searchParams={searchParams} />
    </Suspense>
  )
}
