import type { Metadata } from "next"

import { ShopDashboard } from "@/features/shop/components/shop-dashboard"

export const metadata: Metadata = { title: "Ma boutique · Chicman" }

export default function SellerShopPage() {
  return <ShopDashboard />
}
