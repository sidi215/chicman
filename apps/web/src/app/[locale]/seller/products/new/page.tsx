
import { ProductCreate } from "@/features/products/components/product-create"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Nouveau produit · Chicman", ar: "منتج جديد · شيكمان" })

export default function NewProductPage() {
  return <ProductCreate />
}
