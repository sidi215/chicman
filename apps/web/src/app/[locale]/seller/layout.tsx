import type { ReactNode } from "react"

import { NotificationsProvider } from "@/features/notifications/notifications-provider"
import { SellerShell } from "@/features/seller/components/seller-shell"
import { SellerShopProvider } from "@/features/seller/seller-shop-provider"

/**
 * The seller area (spec 16): header with the notification bell (spec 15), the
 * navigation the shop status allows, and the restricted states. The API
 * authorizes every request on its own.
 */
export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <SellerShopProvider>
        <SellerShell>{children}</SellerShell>
      </SellerShopProvider>
    </NotificationsProvider>
  )
}
