
import { ShopDashboard } from "@/features/shop/components/shop-dashboard"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Ma boutique · Chicman", ar: "متجري · شيكمان" })

export default function SellerShopPage() {
  return (
    <SellerAreaGate area="shop">
      <ShopDashboard />
    </SellerAreaGate>
  )
}
