"use client"

import type { OwnerShopResponse } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

import { useAccount } from "@/features/auth/account-provider"
import { useAuth } from "@/features/auth/auth-provider"
import { interpretShopResult } from "@/features/shop/shop-form"
import { apiRequest } from "@/lib/api-client"

import { SELLER_SHOP_PATH, type SellerShopState } from "./seller-dashboard"

interface SellerShopContextValue {
  shop: SellerShopState
  /** Reads the shop again; the last known state stays shown meanwhile. */
  refresh: () => Promise<void>
}

const SellerShopContext = createContext<SellerShopContextValue | null>(null)

/**
 * The signed-in user's shop (`GET /sellers/me/shop`, spec 06) for the seller
 * shell: its status chooses the navigation and the restricted states. Read on
 * sign-in; the shell calls `refresh` on each page change, so a status changed
 * elsewhere (approval, suspension) shows on the next page. An answer for a
 * previous account is dropped. Guests go to the login page.
 */
export function SellerShopProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { status, getAccessToken, signOut } = useAuth()
  const { account: signedIn } = useAccount()
  // Only a Seller account has a shop to read (AT-1); the area gate sends anyone else home.
  const isSeller = signedIn.state === "active" && signedIn.accountType === "SELLER"
  const [shop, setShop] = useState<SellerShopState>({ state: "loading" })
  const account = useRef(0)

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
    return () => {
      account.current += 1
      // Never show one account's shop to the next.
      setShop({ state: "loading" })
    }
  }, [status, router])

  const read = useCallback(async (): Promise<SellerShopState | null> => {
    const started = account.current
    const token = await getAccessToken()
    if (token === null || started !== account.current) return null
    const outcome = interpretShopResult(await apiRequest<OwnerShopResponse>(SELLER_SHOP_PATH, token))
    if (started !== account.current) return null
    switch (outcome.state) {
      case "ok":
        return { state: "shop", shop: outcome.shop }
      case "no-shop":
        return { state: "no-shop" }
      case "signed-out":
        void signOut()
        return null
      case "forbidden":
        // No seller profile is possible for this account (spec 06); same as the shop page.
        router.replace("/account")
        return null
      case "unavailable":
        return { state: "unavailable" }
      default:
        return { state: "error" }
    }
  }, [getAccessToken, signOut, router])

  const refresh = useCallback(async () => {
    const next = await read()
    if (next !== null) setShop(next)
  }, [read])

  useEffect(() => {
    if (status !== "signed-in" || !isSeller) return
    let cancelled = false
    void read().then((next) => {
      if (!cancelled && next !== null) setShop(next)
    })
    return () => {
      cancelled = true
    }
  }, [status, isSeller, read])

  return <SellerShopContext.Provider value={{ shop, refresh }}>{children}</SellerShopContext.Provider>
}

export function useSellerShop(): SellerShopContextValue {
  const value = useContext(SellerShopContext)
  if (value === null) throw new Error("useSellerShop must be used inside SellerShopProvider")
  return value
}
