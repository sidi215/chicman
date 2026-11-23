"use client"

import { LogOut } from "lucide-react"

import { buttonVariants } from "@/components/ui/button"

import { useAccountMessages } from "../account-messages"
import { useAuth } from "../auth-provider"

/**
 * Sign-out, in the buyer, seller, and administrator headers. The profile, the
 * language, and the appearance live on the shared profile page, reached from
 * each area's side navigation.
 */
export function SignOutAction() {
  const t = useAccountMessages()
  const { status, signOut } = useAuth()
  if (status !== "signed-in") return null
  return (
    <button type="button" aria-label={t.signOut} title={t.signOut} onClick={() => void signOut()} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
      <LogOut aria-hidden className="size-icon-action" />
    </button>
  )
}
