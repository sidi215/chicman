"use client"

import { LogOut, UserRound } from "lucide-react"
import Link from "next/link"

import { buttonVariants } from "@/components/ui/button"

import { useAccountMessages } from "../account-messages"
import { useAuth } from "../auth-provider"

/** Profile (every type, Q2) and sign-out, for the seller and administrator headers. */
export function AccountActions() {
  const t = useAccountMessages()
  const { status, signOut } = useAuth()
  if (status !== "signed-in") return null
  return (
    <>
      <Link href="/account/profile" aria-label={t.profile} title={t.profile} className={buttonVariants({ variant: "outline", size: "icon-sm" })}>
        <UserRound aria-hidden className="size-icon-action" />
      </Link>
      <button type="button" aria-label={t.signOut} title={t.signOut} onClick={() => void signOut()} className={buttonVariants({ variant: "ghost", size: "icon-sm" })}>
        <LogOut aria-hidden className="size-icon-action" />
      </button>
    </>
  )
}
