import { Suspense } from "react"

import { AccountGate } from "@/features/auth/components/account-gate"
import { AdminProductScreen } from "@/features/moderation/components/admin-moderation"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Produit · Administration · Chicman", ar: "المنتج · الإدارة · شيكمان" })

async function ProductRoute({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params
  return (
    <AccountGate area="admin">
      <AdminProductScreen productId={productId} />
    </AccountGate>
  )
}

/** `/admin/products/[productId]` (spec 19): content, states, history, and the moderation actions. */
export default function AdminProductPage({ params }: PageProps<"/[locale]/admin/products/[productId]">) {
  return (
    <Suspense>
      <ProductRoute params={params} />
    </Suspense>
  )
}
