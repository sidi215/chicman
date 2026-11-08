import type { Metadata } from "next"
import { Suspense } from "react"

import { AdminShopDetail } from "@/features/admin/components/admin-shops"

export const metadata: Metadata = { title: "Boutique · Administration · Chicman" }

async function ShopDetailRoute({ params }: { params: Promise<{ shopId: string }> }) {
  const { shopId } = await params
  return <AdminShopDetail shopId={shopId} />
}

export default function AdminShopDetailPage({ params }: PageProps<"/admin/shops/[shopId]">) {
  return (
    <Suspense>
      <ShopDetailRoute params={params} />
    </Suspense>
  )
}
