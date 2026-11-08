import { Suspense } from "react"

import { AdminShopDetail } from "@/features/admin/components/admin-shops"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Boutique · Administration · Chicman", ar: "المتجر · الإدارة · شيكمان" })

async function ShopDetailRoute({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params
  return <AdminShopDetail shopId={shopId} />
}

export default function AdminShopDetailPage({ params }: PageProps<"/[locale]/admin/shops/[shopId]">) {
  return (
    <Suspense>
      <ShopDetailRoute params={params} />
    </Suspense>
  )
}
