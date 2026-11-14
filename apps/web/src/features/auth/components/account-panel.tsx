"use client"

import type { AccountProfileResponse, CustomerAddressListResponse } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { dismissAddressPrompt, isAddressPromptDismissed } from "@/features/addresses/address-form"
import { apiRequest } from "@/lib/api-client"

import { ACCOUNT_PATH } from "../account"
import { useAuth } from "../auth-provider"
import { useAuthMessages } from "../use-auth-messages"
import { AuthShell } from "./auth-shell"
import { FormMessage } from "./form-field"
import { TextLink } from "./text-link"

type View = { state: "loading" } | { state: "ready"; account: AccountProfileResponse } | { state: "failed" }

/**
 * `/account`: the Buyer's home (AT-1). Rendered inside `AccountGate area="buyer"`,
 * which has already checked the session and sent every other type, and an
 * identity without an account, where they belong.
 */
export function AccountPanel() {
  const t = useAuthMessages()
  const router = useRouter()
  const { session, getAccessToken, signOut } = useAuth()
  const [view, setView] = useState<View>({ state: "loading" })
  // Number of saved delivery addresses (spec 05), or null while unknown.
  const [addressCount, setAddressCount] = useState<number | null>(null)
  const [promptDismissed, setPromptDismissed] = useState(true)
  const [reloads, setReloads] = useState(0)

  // Reads everything first; the effect then sets the state in one place.
  const load = useCallback(async (): Promise<{ view: View; addressCount: number | null; promptDismissed: boolean } | null> => {
    const token = await getAccessToken()
    if (!token) return null
    const result = await apiRequest<AccountProfileResponse>(ACCOUNT_PATH, token)
    if (result.kind === "unauthorized") {
      void signOut()
      return null
    }
    const addresses = await apiRequest<CustomerAddressListResponse>("/customers/me/addresses", token)
    return {
      view: result.kind === "ok" ? { state: "ready", account: result.data } : { state: "failed" },
      addressCount: addresses.kind === "ok" ? addresses.data.addresses.length : null,
      promptDismissed: isAddressPromptDismissed(typeof window === "undefined" ? null : window.localStorage),
    }
  }, [getAccessToken, signOut])

  useEffect(() => {
    let cancelled = false
    void load().then((loaded) => {
      if (cancelled || loaded === null) return
      setView(loaded.view)
      setAddressCount(loaded.addressCount)
      setPromptDismissed(loaded.promptDismissed)
    })
    return () => {
      cancelled = true
    }
  }, [load, reloads])

  const email = session?.user.email

  return (
    <AuthShell brand={t.brand} title={t.accountTitle} description={email ? `${t.signedInAs} ${email}` : undefined}>
      {view.state === "loading" ? <FormMessage tone="info">{t.loading}</FormMessage> : null}
      {view.state === "failed" ? (
        <>
          <FormMessage tone="error">{t.errors.generic}</FormMessage>
          <Button variant="outline" onClick={() => setReloads((count) => count + 1)}>
            {t.retry}
          </Button>
        </>
      ) : null}
      {view.state === "ready" ? (
        <>
          {view.account.profile.fullName ? <p className="type-title-medium">{view.account.profile.fullName}</p> : null}
          <p className="type-body-medium">
            <span className="text-muted-foreground">{t.contactPhone} : </span>
            <span dir="ltr">{view.account.profile.phone}</span>
          </p>
          <TextLink href="/account/profile">{t.profileSettings}</TextLink>
          <TextLink href="/account/orders">{t.myOrders}</TextLink>
          <TextLink href="/account/addresses">{t.myAddresses}</TextLink>
          {addressCount === 0 && !promptDismissed ? (
            <section className="flex flex-col gap-2 rounded-2xl bg-muted p-4" aria-labelledby="address-prompt-title">
              <p id="address-prompt-title" className="type-title-small">
                {t.addressPromptTitle}
              </p>
              <p className="type-body-small text-muted-foreground">{t.addressPromptBody}</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => router.push("/account/addresses/new")}>{t.addressPromptAdd}</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    dismissAddressPrompt(window.localStorage)
                    setPromptDismissed(true)
                  }}
                >
                  {t.addressPromptLater}
                </Button>
              </div>
            </section>
          ) : null}
        </>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => void signOut()}>
          {t.logout}
        </Button>
      </div>
    </AuthShell>
  )
}
