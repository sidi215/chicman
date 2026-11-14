"use client"

import { useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"

import { Button } from "@/components/ui/button"

import { areaDecision, type AccountArea } from "../account"
import { useAccountMessages } from "../account-messages"
import { useAccount } from "../account-provider"
import { FormMessage } from "./form-field"

/**
 * A page's content for the account types its area admits (AT-1, section 12).
 * Another type is sent to its own home, a guest to the login page, an
 * identity without an account to the setup page. Used inside each page, never
 * as a layout that would drop `{children}` (instant navigation, spec 16). The
 * API authorizes every request on its own: this only routes.
 */
export function AccountGate({ area, children }: { area: AccountArea; children: ReactNode }) {
  const t = useAccountMessages()
  const router = useRouter()
  const { account, refresh } = useAccount()
  const decision = areaDecision(area, account)
  const target = decision.kind === "redirect" ? decision.to : null

  useEffect(() => {
    if (target !== null) router.replace(target)
  }, [target, router])

  if (decision.kind === "render") return children
  if (decision.kind === "failed") {
    return (
      <main className="flex flex-1 flex-col items-center gap-3 px-page-gutter py-10">
        <FormMessage tone="error">{decision.reason === "unavailable" ? t.unavailable : t.generic}</FormMessage>
        <Button variant="outline" onClick={() => void refresh()}>
          {t.retry}
        </Button>
      </main>
    )
  }
  return (
    <main className="flex flex-1 flex-col items-center px-page-gutter py-10">
      <FormMessage tone="info">{t.loading}</FormMessage>
    </main>
  )
}
