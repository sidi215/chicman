import { FavoritesPage } from "@/features/favorites/components/favorites-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mes favoris · Chicman", ar: "مفضلتي · شيكمان" }, { robots: { index: false, follow: false } })

export default function FavoritesRoute() {
  return <FavoritesPage />
}
