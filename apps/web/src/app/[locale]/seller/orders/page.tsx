import { SellerOrderList } from "@/features/orders/components/seller-orders"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Commandes de la boutique · Chicman", ar: "طلبات المتجر · شيكمان" })

/** `/seller/orders` (spec 11, web only: O1). */
export default function SellerOrdersPage() {
  return <SellerOrderList />
}
