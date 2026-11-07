"use client"

import type { CustomerProfileResponse } from "@chicman/shared"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
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

  useEffect(() => {
    if (status === "signed-out" || status === "not-configured") router.replace("/login")
  }, [status, router])

  const loadAccount = useCallback(async () => {
    const token = await getAccessToken()
    if (!token) return
    const result = await apiRequest<CustomerProfileResponse>("/customers/me", token)
    if (result.kind === "ok") setAccount(result.data)
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
