import { NotificationsPage } from "@/features/notifications/components/notifications-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Notifications · Chicman", ar: "الإشعارات · شيكمان" }, { robots: { index: false, follow: false } })

/** `/notifications`: the user's notification center (spec 15). */
export default function NotificationsRoute() {
  return <NotificationsPage />
}
