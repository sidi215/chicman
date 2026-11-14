
import { ProductList } from "@/features/products/components/product-list"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes produits · Chicman", ar: "منتجاتي · شيكمان" })

export default function SellerProductsPage() {
  return (
    <SellerAreaGate area="products">
      <ProductList />
    </SellerAreaGate>
  )
}
