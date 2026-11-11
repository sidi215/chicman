import type { ReactNode } from "react"

import { NotificationsAreaBar } from "@/features/notifications/components/area-bar"
import { NotificationsProvider } from "@/features/notifications/notifications-provider"

/** The seller area: every page shows the notification bell (spec 15). */
export default function SellerLayout({ children }: { children: ReactNode }) {
  return (
    <NotificationsProvider>
      <div className="flex flex-1 flex-col bg-page">
        <NotificationsAreaBar href="/seller/notifications" />
        {children}
      </div>
    </NotificationsProvider>
  )
}
