import type { PublicProductDetail } from "@chicman/shared"
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Suspense } from "react"

import { loadCatalog } from "@/features/storefront/catalog-server"
import { CatalogFailureView } from "@/features/storefront/components/catalog-failure"
import { ProductDetails, ProductPageFrame } from "@/features/storefront/components/product-details"
import { STOREFRONT_MESSAGES } from "@/features/storefront/messages"
import { isProductId } from "@/features/storefront/product-check"
import { productJsonLd, productMetadata, serializeJsonLd } from "@/features/storefront/seo"
import { currentLocale } from "@/lib/page-metadata"

type Params = Promise<{ productId: string }>

const load = (productId: string) =>
  isProductId(productId) ? loadCatalog<PublicProductDetail>(`/products/${productId}`) : Promise.resolve({ state: "not-found" } as const)

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const locale = await currentLocale()
  const outcome = await load((await params).productId)
  if (outcome.state === "ok") return productMetadata(outcome.data, locale)
  // A missing product, or a failure that must not replace the page in search results.
  return { title: STOREFRONT_MESSAGES[locale].brand, robots: { index: false } }
}

async function ProductRoute({ params }: { params: Params }) {
  const locale = await currentLocale()
  const outcome = await load((await params).productId)
  if (outcome.state === "not-found") notFound()
  if (outcome.state !== "ok") return <CatalogFailureView failure={outcome.state} />
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd(outcome.data, locale)) }} />
      <ProductDetails product={outcome.data} />
    </>
  )
}

export default async function ProductPage({ params }: { params: Params }) {
  const t = STOREFRONT_MESSAGES[await currentLocale()]
  return (
    <ProductPageFrame>
      <Suspense fallback={<p className="type-body-medium text-muted-foreground">{t.loading}</p>}>
        <ProductRoute params={params} />
      </Suspense>
    </ProductPageFrame>
  )
}
