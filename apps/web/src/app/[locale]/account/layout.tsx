import type { ReactNode } from "react"

import { BuyerShell } from "@/features/buyer/components/buyer-shell"
import { CartProvider } from "@/features/cart/cart-provider"
import { FavoritesProvider } from "@/features/favorites/favorites-provider"
import { NotificationsProvider } from "@/features/notifications/notifications-provider"

/**
 * The buyer dashboard (`/account`): the header and navigation shared with the
 * seller and administrator areas, around the existing buyer pages. Always
 * renders its pages; each page gates itself, and the API authorizes every
 * request. Account setup and a non-buyer's profile page render without the
 * shell.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <FavoritesProvider>
        <NotificationsProvider>
          <BuyerShell>{children}</BuyerShell>
        </NotificationsProvider>
      </FavoritesProvider>
    </CartProvider>
  )
}
