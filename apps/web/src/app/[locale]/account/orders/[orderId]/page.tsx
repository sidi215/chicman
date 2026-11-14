import { Suspense } from "react"

import { CustomerOrderDetail } from "@/features/orders/components/customer-orders"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Ma commande · Chicman", ar: "طلبي · شيكمان" })

async function OrderRoute({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params
  return (
    <AccountGate area="buyer">
      <CustomerOrderDetail orderId={orderId} />
    </AccountGate>
  )
}

/** `/account/orders/[orderId]` (spec 11): one of the customer's orders; another's is not found. */
export default function AccountOrderPage({ params }: PageProps<"/[locale]/account/orders/[orderId]">) {
  return (
    <Suspense>
      <OrderRoute params={params} />
    </Suspense>
  )
}
