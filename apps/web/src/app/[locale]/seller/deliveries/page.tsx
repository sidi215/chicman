import { SellerInProgressDeliveries } from "@/features/orders/components/seller-deliveries"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Livraisons en cours · Chicman", ar: "التوصيلات الجارية · شيكمان" })

/** `/seller/deliveries` (spec 12, web only: O1): deliveries to finish, including a suspended shop's (D8). */
export default function SellerDeliveriesPage() {
  return <SellerInProgressDeliveries />
}
