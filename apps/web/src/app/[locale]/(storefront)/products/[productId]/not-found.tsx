"use client"

import { ProductNotFound, ProductPageFrame } from "@/features/storefront/components/product-details"

export default function NotFound() {
  return (
    <ProductPageFrame>
      <ProductNotFound />
    </ProductPageFrame>
  )
}
