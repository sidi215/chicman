import { AccountGate } from "@/features/auth/components/account-gate"
import { AccountSetup } from "@/features/auth/components/account-setup-form"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Finaliser mon compte · Chicman", ar: "إكمال حسابي · شيكمان" }, { robots: { index: false, follow: false } })

/** `/account/setup` (AT-1): the account of the registered type, after email confirmation. */
export default function AccountSetupPage() {
  return (
    <AccountGate area="setup">
      <AccountSetup />
    </AccountGate>
  )
}
