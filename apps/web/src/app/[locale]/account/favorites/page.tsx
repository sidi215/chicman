import { AccountGate } from "@/features/auth/components/account-gate"
import { FavoritesPage } from "@/features/favorites/components/favorites-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes favoris · Chicman", ar: "مفضلتي · شيكمان" }, { robots: { index: false, follow: false } })

/** `/account/favorites` (spec 14), in the buyer dashboard. */
export default function AccountFavoritesRoute() {
  return (
    <AccountGate area="buyer">
      <FavoritesPage />
    </AccountGate>
  )
}
