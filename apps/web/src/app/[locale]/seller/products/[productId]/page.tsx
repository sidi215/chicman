import { Suspense } from "react"

import { ProductDetailScreen } from "@/features/products/components/product-detail"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Produit · Chicman", ar: "المنتج · شيكمان" })

async function ProductRoute({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  return (
    <SellerAreaGate area="products">
      <ProductDetailScreen productId={productId} />
    </SellerAreaGate>
  )
}

export default function ProductPage({ params }: PageProps<"/[locale]/seller/products/[productId]">) {
  return (
    <Suspense>
      <ProductRoute params={params} />
    </Suspense>
  )
}
