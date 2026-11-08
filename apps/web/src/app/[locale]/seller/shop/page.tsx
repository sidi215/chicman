
import { ShopDashboard } from "@/features/shop/components/shop-dashboard"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Ma boutique · Chicman", ar: "متجري · شيكمان" })

export default function SellerShopPage() {
  return <ShopDashboard />
}
