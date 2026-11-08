import type { Metadata } from "next"
import { Suspense } from "react"

import { ProductDetailScreen } from "@/features/products/components/product-detail"

export const metadata: Metadata = { title: "Produit · Chicman" }

async function ProductRoute({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  return <ProductDetailScreen productId={productId} />
}

export default function ProductPage({ params }: PageProps<"/seller/products/[productId]">) {
  return (
    <Suspense>
      <ProductRoute params={params} />
    </Suspense>
  )
}
