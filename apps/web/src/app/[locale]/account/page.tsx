
import { AccountPanel } from "@/features/auth/components/account-panel"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mon compte · Chicman", ar: "حسابي · شيكمان" })

export default function AccountPage() {
  return (
    <AccountGate area="buyer">
      <AccountPanel />
    </AccountGate>
  )
}
