
import { AccountPanel } from "@/features/auth/components/account-panel"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mon compte · Chicman", ar: "حسابي · شيكمان" })

export default function AccountPage() {
  return <AccountPanel />
}
