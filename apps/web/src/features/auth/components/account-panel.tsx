"use client"

import type { CustomerAddressListResponse, CustomerProfileResponse } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { dismissAddressPrompt, isAddressPromptDismissed } from "@/features/addresses/address-form"
import { apiRequest } from "@/lib/api-client"

import { useAuth } from "../auth-provider"
import type { SessionCheck } from "../session-check"
import { useAuthMessages } from "../use-auth-messages"
import { AccountSetupForm } from "./account-setup-form"
import { AuthShell } from "./auth-shell"
import { FormMessage } from "./form-field"
import { TextLink } from "./text-link"

/** Signed-in area: API session check, account setup when needed, logout. */
export function AccountPanel() {
  const t = useAuthMessages()
  const router = useRouter()
  const { status, session, checkSession, getAccessToken, signOut } = useAuth()
  const [check, setCheck] = useState<SessionCheck | null>(null)
  const [account, setAccount] = useState<CustomerProfileResponse | null>(null)
  const [pending, setPending] = useState(false)
  // Number of saved delivery addresses (spec 05), or null while unknown.
  const [addressCount, setAddressCount] = useState<number | null>(null)
  const [promptDismissed, setPromptDismissed] = useState(true)

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])

  const loadAccount = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    const result = await apiRequest<CustomerProfileResponse>("/customers/me", token)
    if (result.kind === "ok") setAccount(result.data)
    const addresses = await apiRequest<CustomerAddressListResponse>("/customers/me/addresses", token)
    if (addresses.kind === "ok") setAddressCount(addresses.data.addresses.length)
    setPromptDismissed(isAddressPromptDismissed(typeof window === "undefined" ? null : window.localStorage))
  }, [getAccessToken])

  const runCheck = useCallback(async () => {
    setPending(true)
    const result = await checkSession()
    setCheck(result)
    if (result.state === "active") await loadAccount()
    setPending(false)
  }, [checkSession, loadAccount])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void checkSession().then(async (result) => {
      if (cancelled) return
      setCheck(result)
      if (result.state === "active") await loadAccount()
    })
    return () => {
      cancelled = true
    }
  }, [status, checkSession, loadAccount])

  if (status !== "signed-in") {
    return (
      <AuthShell brand={t.brand} title={t.accountTitle}>
        <FormMessage tone="info">{t.loading}</FormMessage>
      </AuthShell>
    )
  }

  const email = session?.user.email
  const roles = account?.roles ?? (check?.state === "active" ? check.session.roles : null)

  return (
    <AuthShell brand={t.brand} title={t.accountTitle} description={email ? `${t.signedInAs} ${email}` : undefined}>
      {check === null ? <FormMessage tone="info">{t.sessionChecking}</FormMessage> : null}
      {check?.state === "not-bootstrapped" && account === null ? (
        <AccountSetupForm
          onDone={(created) => {
            setAccount(created)
            setCheck({ state: "active", session: { userId: created.userId, roles: created.roles } })
            // Spec 05: offer the delivery location right after account setup (skippable).
            router.push("/account/addresses/new?onboarding=1")
          }}
        />
      ) : null}
      {roles ? <FormMessage tone="info">{`${t.sessionActive} ${t.roles} : ${roles.join(", ")}`}</FormMessage> : null}
      {account ? (
        <>
          {account.profile.fullName ? <p className="type-title-medium">{account.profile.fullName}</p> : null}
          <p className="type-body-medium">
            <span className="text-muted-foreground">{t.contactPhone} : </span>
            <span dir="ltr">{account.profile.phone}</span>
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
          <TextLink href="/seller/shop">{t.myShop}</TextLink>
          {/* Navigation only: the API enforces the approved-seller rule. */}
          {account.roles.includes("SELLER") ? <TextLink href="/seller/products">{t.myProducts}</TextLink> : null}
          {account.roles.includes("SELLER") ? <TextLink href="/seller/orders">{t.shopOrders}</TextLink> : null}
          {/* Navigation only: the API enforces the ADMIN role. */}
          {account.roles.includes("ADMIN") ? <TextLink href="/admin/shops">{t.adminShops}</TextLink> : null}
        </>
      ) : null}
      {check?.state === "unavailable" ? <FormMessage tone="error">{t.authUnavailable}</FormMessage> : null}
      {check?.state === "signed-out" ? <FormMessage tone="error">{t.sessionInvalid}</FormMessage> : null}
      {check?.state === "error" ? <FormMessage tone="error">{t.errors.generic}</FormMessage> : null}
      <div className="flex flex-wrap gap-2">
        {check?.state === "unavailable" || check?.state === "error" ? (
          <Button variant="outline" disabled={pending} onClick={runCheck}>
            {t.retry}
          </Button>
        ) : null}
        <Button variant="secondary" onClick={() => void signOut()}>
          {t.logout}
        </Button>
      </div>
    </AuthShell>
  )
}
