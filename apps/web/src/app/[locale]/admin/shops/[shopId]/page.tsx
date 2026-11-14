import { Suspense } from "react"

import { AdminShopDetail } from "@/features/admin/components/admin-shops"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Boutique · Administration · Chicman", ar: "المتجر · الإدارة · شيكمان" })

async function ShopDetailRoute({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params
  return (
    <AccountGate area="admin">
      <AdminShopDetail shopId={shopId} />
    </AccountGate>
  )
}

export default function AdminShopDetailPage({ params }: PageProps<"/[locale]/admin/shops/[shopId]">) {
  return (
    <Suspense>
      <ShopDetailRoute params={params} />
    </Suspense>
  )
}
