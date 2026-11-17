import { AccountGate } from "@/features/auth/components/account-gate"
import { NotificationsPage } from "@/features/notifications/components/notifications-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Notifications · Chicman", ar: "الإشعارات · شيكمان" }, { robots: { index: false, follow: false } })

/** `/account/notifications`: the buyer's notification center (spec 15), in the buyer dashboard. */
export default function AccountNotificationsRoute() {
  return (
    <AccountGate area="buyer">
      <NotificationsPage />
    </AccountGate>
  )
}
