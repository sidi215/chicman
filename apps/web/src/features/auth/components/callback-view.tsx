"use client"

import { useEffect, useRef, useState } from "react"

import { useAuth } from "../auth-provider"
import type { AuthActionResult } from "../auth-service"
import { CALLBACK_DESTINATIONS, parseEmailLinkFragment, type EmailLinkType } from "../callback"
import { useAuthMessages } from "../use-auth-messages"
import { AuthShell } from "./auth-shell"
import { FormMessage } from "./form-field"
import { TextLink } from "./text-link"

type Outcome = { state: "working" } | { state: "invalid"; type: EmailLinkType | null }

/**
 * `/auth/callback` (spec 03): verifies a confirmation or recovery link.
 * - Reads the token hash (custom templates) or the session tokens (Supabase
 *   default templates) from the fragment and removes them from the address
 *   bar before anything else.
 * - Verifies once per link (React may run effects twice in development).
 * - Leaves through a full page load to a fixed destination; no redirect
 *   parameter is ever read. The token is never logged.
 */
export function CallbackView() {
  const t = useAuthMessages()
  const { service, status } = useAuth()
  const [outcome, setOutcome] = useState<Outcome>({ state: "working" })
  const started = useRef<{ type: EmailLinkType | null; result: Promise<AuthActionResult> } | null>(null)

  // A second link opened in this tab only changes the fragment (no page
  // load): reload so it is processed from scratch, once.
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash.length > 1) window.location.reload()
    }
    window.addEventListener("hashchange", onHashChange)
    return () => window.removeEventListener("hashchange", onHashChange)
  }, [])

  useEffect(() => {
    if (status === "loading") return
    if (started.current === null) {
      const link = parseEmailLinkFragment(window.location.hash)
      // Remove the token from the address bar and history immediately.
      window.history.replaceState(null, "", window.location.pathname)
      started.current = {
        type: link?.type ?? null,
        result:
          link === null || service === null
            ? Promise.resolve({ ok: false, error: "generic" })
            : service.verifyEmailLink(link),
      }
    }
    const { type, result } = started.current
    let cancelled = false
    void result.then((verified) => {
      if (cancelled) return
      if (verified.ok && type !== null) window.location.replace(CALLBACK_DESTINATIONS[type])
      else setOutcome({ state: "invalid", type })
    })
    return () => {
      cancelled = true
    }
  }, [service, status])

  if (outcome.state === "working") {
    return (
      <AuthShell brand={t.brand} title={t.callbackTitle}>
        <FormMessage tone="info">{t.callbackWorking}</FormMessage>
      </AuthShell>
    )
  }
  return (
    <AuthShell brand={t.brand} title={t.linkInvalidTitle} description={t.linkInvalidBody}>
      {outcome.type === "recovery" ? (
        <>
          <FormMessage tone="info">{t.linkInvalidRecoveryHint}</FormMessage>
          <TextLink href="/forgot-password" fullLoad>{t.toForgot}</TextLink>
        </>
      ) : (
        <>
          <FormMessage tone="info">{t.linkInvalidConfirmHint}</FormMessage>
          <TextLink href="/login" fullLoad>{t.toLogin}</TextLink>
          <TextLink href="/register" fullLoad>{t.resendConfirmation}</TextLink>
        </>
      )}
    </AuthShell>
  )
}
