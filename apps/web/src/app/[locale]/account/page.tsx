import { AccountGate } from "@/features/auth/components/account-gate"
import { BuyerOverview } from "@/features/buyer/components/buyer-overview"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mon espace · Chicman", ar: "مساحتي · شيكمان" })

/** `/account`: the buyer dashboard's overview. */
export default function AccountPage() {
  return (
    <AccountGate area="buyer">
      <BuyerOverview />
    </AccountGate>
  )
}
