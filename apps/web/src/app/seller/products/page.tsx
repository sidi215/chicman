import type { Metadata } from "next"

import { ProductList } from "@/features/products/components/product-list"

export const metadata: Metadata = { title: "Mes produits · Chicman" }

export default function SellerProductsPage() {
  return <ProductList />
}
