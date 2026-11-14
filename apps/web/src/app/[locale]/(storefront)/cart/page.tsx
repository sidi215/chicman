import { CartPage } from "@/features/cart/components/cart-page"
import { AccountGate } from "@/features/auth/components/account-gate"
import { localizedMetadata } from "@/lib/page-metadata"

export const generateMetadata = localizedMetadata({ fr: "Mon panier · Chicman", ar: "سلتي · شيكمان" }, { robots: { index: false, follow: false } })

export default function CartRoute() {
  return (
    <AccountGate area="buyer">
      <CartPage />
    </AccountGate>
  )
}
