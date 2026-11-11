import type { ReactNode } from "react"

import { CartProvider } from "@/features/cart/cart-provider"
import { FavoritesProvider } from "@/features/favorites/favorites-provider"
import { NotificationsProvider } from "@/features/notifications/notifications-provider"
import { StorefrontHeader } from "@/features/storefront/components/storefront-header"

/** The public storefront: no page in this group requires an account. */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <CartProvider>
      <FavoritesProvider>
        <NotificationsProvider>
          <div className="flex flex-1 flex-col bg-page">
            <StorefrontHeader />
            {children}
          </div>
        </NotificationsProvider>
      </FavoritesProvider>
    </CartProvider>
  )
}
