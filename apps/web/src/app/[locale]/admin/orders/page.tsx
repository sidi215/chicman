import { Suspense } from "react"

import { shopIdFilter } from "@/features/admin/admin-dashboard"
import { AdminOrderList } from "@/features/admin/components/admin-orders"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Commandes · Administration · Chicman", ar: "الطلبات · الإدارة · شيكمان" })

async function OrdersRoute({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { shopId } = await searchParams
  const initialShopId = shopIdFilter(shopId)
  return (
    <AccountGate area="admin">
      {/* Keyed so a link to another shop's orders starts from that shop. */}
      <AdminOrderList key={initialShopId ?? "all"} initialShopId={initialShopId} />
    </AccountGate>
  )
}

/** `/admin/orders` (spec 17; routes from spec 11): order and delivery oversight. */
export default function AdminOrdersPage({ searchParams }: PageProps<"/[locale]/admin/orders">) {
  return (
    <Suspense>
      <OrdersRoute searchParams={searchParams} />
    </Suspense>
  )
}
