import { NotificationsPage } from "@/features/notifications/components/notifications-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Notifications · Boutique · Chicman", ar: "الإشعارات · المتجر · شيكمان" }, { robots: { index: false, follow: false } })

/** `/seller/notifications`: the notification center in the seller area (spec 15). */
export default function SellerNotificationsRoute() {
  return <NotificationsPage />
}
