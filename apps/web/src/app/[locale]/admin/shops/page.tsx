
import { AdminShopList } from "@/features/admin/components/admin-shops"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Boutiques · Administration · Chicman", ar: "المتاجر · الإدارة · شيكمان" })

export default function AdminShopsPage() {
  return (
    <AccountGate area="admin">
      <AdminShopList />
    </AccountGate>
  )
}
