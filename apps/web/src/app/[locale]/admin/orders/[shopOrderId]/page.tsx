import { Suspense } from "react"

import { AdminOrderDetail } from "@/features/admin/components/admin-orders"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Commande · Administration · Chicman", ar: "الطلب · الإدارة · شيكمان" })

async function OrderDetailRoute({ params }: { params: Promise<{ shopOrderId: string }> }) {
  const { shopOrderId } = await params
  return (
    <AccountGate area="admin">
      <AdminOrderDetail shopOrderId={shopOrderId} />
    </AccountGate>
  )
}

export default function AdminOrderDetailPage({ params }: PageProps<"/[locale]/admin/orders/[shopOrderId]">) {
  return (
    <Suspense>
      <OrderDetailRoute params={params} />
    </Suspense>
  )
}
