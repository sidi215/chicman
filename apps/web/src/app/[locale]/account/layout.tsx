import type { ReactNode } from "react"

import { AccountAreaShell } from "@/features/auth/components/account-area-shell"
import { CartProvider } from "@/features/cart/cart-provider"
import { FavoritesProvider } from "@/features/favorites/favorites-provider"
import { NotificationsProvider } from "@/features/notifications/notifications-provider"

/**
 * The buyer dashboard (`/account`): the header and navigation shared with the
 * seller and administrator areas, around the existing buyer pages. Always
 * renders its pages; each page gates itself, and the API authorizes every
 * request. Account setup renders without a shell; the shared profile page
 * opens in a Seller's or an Administrator's own area.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <FavoritesProvider>
        <NotificationsProvider>
          <AccountAreaShell>{children}</AccountAreaShell>
        </NotificationsProvider>
      </FavoritesProvider>
    </CartProvider>
  )
}
