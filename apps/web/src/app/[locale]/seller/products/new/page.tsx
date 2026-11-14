
import { ProductCreate } from "@/features/products/components/product-create"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Nouveau produit · Chicman", ar: "منتج جديد · شيكمان" })

export default function NewProductPage() {
  return (
    <SellerAreaGate area="products">
      <ProductCreate />
    </SellerAreaGate>
  )
}
