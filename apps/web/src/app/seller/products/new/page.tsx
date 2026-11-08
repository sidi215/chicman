import type { Metadata } from "next"

import { ProductCreate } from "@/features/products/components/product-create"

export const metadata: Metadata = { title: "Nouveau produit · Chicman" }

export default function NewProductPage() {
  return <ProductCreate />
}
