import { Suspense } from "react"

import { SellerOrderDetail } from "@/features/orders/components/seller-orders"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Commande · Chicman", ar: "طلب · شيكمان" })

async function ShopOrderRoute({ params }: { params: Promise<{ shopOrderId: string }> }) {
  const { shopOrderId } = await params
  return <SellerOrderDetail shopOrderId={shopOrderId} />
}

/** `/seller/orders/[shopOrderId]` (spec 11): confirm, reject, cancel; staged delivery details. */
export default function SellerOrderPage({ params }: PageProps<"/[locale]/seller/orders/[shopOrderId]">) {
  return (
    <Suspense>
      <ShopOrderRoute params={params} />
    </Suspense>
  )
}
