"use client"

import type { CustomerProfileResponse } from "@chicman/shared"
import { useCallback, useEffect } from "react"

import { useAuth } from "@/features/auth/auth-provider"
import { apiRequest } from "@/lib/api-client"
import type { Locale } from "@/lib/locale"
import { clearLocaleSynced, goToLocale, isLocaleSynced, markLocaleSynced } from "@/lib/locale-choice"
import { useLocale } from "@/lib/locale-provider"

const SAVE_WAIT_MS = 1_500

/** Writes the language to the profile of a signed-in user. Failures are not shown: the device keeps the choice. */
export function useSaveProfileLocale() {
  const { session, getAccessToken } = useAuth()
  const userId = session?.user.id
  return useCallback(
    async (locale: Locale) => {
      if (userId === undefined) return
      markLocaleSynced(userId)
      const token = await getAccessToken().catch(() => null)
      if (token === null) return
      // `keepalive` lets the request finish if the page leaves first.
      const save = apiRequest("/customers/me", token, {
        method: "PATCH",
        keepalive: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ preferredLocale: locale }),
      })
      await Promise.race([save, new Promise((resolve) => setTimeout(resolve, SAVE_WAIT_MS))])
    },
    [userId, getAccessToken]
  )
}

/** The profile's language applies once per browser session. Email links are left to finish undisturbed. */
export function useApplyProfileLocale(): void {
  const { status, session, getAccessToken } = useAuth()
  const locale = useLocale()
  const userId = session?.user.id

  useEffect(() => {
    if (status === "signed-out") {
      clearLocaleSynced()
      return
    }
    if (status !== "signed-in" || userId === undefined) return
    if (window.location.pathname.startsWith("/auth/") || isLocaleSynced(userId)) return
    let cancelled = false
    void (async () => {
      const token = await getAccessToken().catch(() => null)
      if (token === null || cancelled) return
      const result = await apiRequest<CustomerProfileResponse>("/customers/me", token)
      // No account yet, or a failure: try again on a later page load.
      if (cancelled || result.kind !== "ok") return
      markLocaleSynced(userId)
      if (result.data.profile.preferredLocale !== locale) goToLocale(result.data.profile.preferredLocale)
    })()
    return () => {
      cancelled = true
    }
  }, [status, userId, locale, getAccessToken])
}
