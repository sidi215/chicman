import type { ReactNode } from "react"

import { StorefrontHeader } from "@/features/storefront/components/storefront-header"

/** The public storefront: no page in this group requires an account. */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col bg-page">
      <StorefrontHeader />
      {children}
    </div>
  )
}
