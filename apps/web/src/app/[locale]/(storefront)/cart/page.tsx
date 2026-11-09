import { CartPage } from "@/features/cart/components/cart-page"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mon panier · Chicman", ar: "سلتي · شيكمان" }, { robots: { index: false, follow: false } })

export default function CartRoute() {
  return <CartPage />
}
