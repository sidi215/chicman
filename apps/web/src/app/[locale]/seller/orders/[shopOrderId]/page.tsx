import { Suspense } from "react"

import { SellerOrderDetail } from "@/features/orders/components/seller-orders"
import { SellerAreaGate } from "@/features/seller/components/seller-area-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Commande · Chicman", ar: "طلب · شيكمان" })

async function ShopOrderRoute({ params }: { params: Promise<{ shopOrderId: string }> }) {
  const { shopOrderId } = await params
  return (
    <SellerAreaGate area="orders">
      <SellerOrderDetail shopOrderId={shopOrderId} />
    </SellerAreaGate>
  )
}

/** `/seller/orders/[shopOrderId]` (spec 11): confirm, reject, cancel; staged delivery details. */
export default function SellerOrderPage({ params }: PageProps<"/[locale]/seller/orders/[shopOrderId]">) {
  return (
    <Suspense>
      <ShopOrderRoute params={params} />
    </Suspense>
  )
}
