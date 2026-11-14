import { SellerOverview } from "@/features/seller/components/seller-overview"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Tableau de bord vendeur · Chicman", ar: "لوحة تحكم البائع · شيكمان" }, { robots: { index: false, follow: false } })

/** `/seller` (spec 16, web only: O1): the seller dashboard's overview. */
export default function SellerDashboardPage() {
  return (
    <SellerAreaGate area="overview">
      <SellerOverview />
    </SellerAreaGate>
  )
}
