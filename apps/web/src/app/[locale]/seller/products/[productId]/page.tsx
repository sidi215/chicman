import { Suspense } from "react"

import { ProductDetailScreen } from "@/features/products/components/product-detail"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Produit · Chicman", ar: "المنتج · شيكمان" })

async function ProductRoute({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  return <ProductDetailScreen productId={productId} />
}

export default function ProductPage({ params }: PageProps<"/[locale]/seller/products/[productId]">) {
  return (
    <Suspense>
      <ProductRoute params={params} />
    </Suspense>
  )
}
