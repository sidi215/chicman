
import { ProductList } from "@/features/products/components/product-list"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes produits · Chicman", ar: "منتجاتي · شيكمان" })

export default function SellerProductsPage() {
  return <ProductList />
}
