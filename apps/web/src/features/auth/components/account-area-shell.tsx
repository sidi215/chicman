"use client"

import type { ReactNode } from "react"

import { InDashboard } from "@/components/layout/in-dashboard"
import { AdminShell } from "@/features/admin/components/admin-shell"
import { BuyerShell } from "@/features/buyer/components/buyer-shell"
import { SellerShell } from "@/features/seller/components/seller-shell"
import { SellerShopProvider } from "@/features/seller/seller-shop-provider"

import { useAccount } from "../account-provider"

/**
 * The layout of `/account/*` by account type, so the profile page every type
 * shares (Q2) opens inside the user's own area, with its side navigation: the
 * seller shell for a Seller, the administrator shell for an Administrator, the
 * buyer shell otherwise (which renders account setup without a shell). Other
 * `/account` pages send Sellers and Administrators away (their gates).
 */
export function AccountAreaShell({ children }: { children: ReactNode }) {
  const { account } = useAccount()
  if (account.state === "active" && account.accountType === "SELLER") {
    return (
      <SellerShopProvider>
        <SellerShell>
          {/* The shell shows the brand: the page drops its own (as in the buyer shell). */}
          <InDashboard>{children}</InDashboard>
        </SellerShell>
      </SellerShopProvider>
    )
  }
  if (account.state === "active" && account.accountType === "ADMIN") {
    return (
      <AdminShell>
        <InDashboard>{children}</InDashboard>
      </AdminShell>
    )
  }
  return <BuyerShell>{children}</BuyerShell>
}
