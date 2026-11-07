"use client"

import type { AuthSessionResponse } from "@chicman/shared"
import type { Session } from "@supabase/supabase-js"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { apiRequest } from "@/lib/api-client"
import { getSupabaseClient } from "@/lib/supabase"

import { createAuthService, type AuthService } from "./auth-service"
import { getAuthCallbackUrl } from "./callback"
import { interpretSessionCheck, shouldEndSession, type SessionCheck } from "./session-check"

type AuthStatus = "loading" | "signed-in" | "signed-out" | "not-configured"

interface AuthContextValue {
  status: AuthStatus
  session: Session | null
  service: AuthService | null
  /** Verifies the current session with the API. A 401 ends the session; a 503 keeps it. */
  checkSession: () => Promise<SessionCheck>
  /** The current access token (refreshed if needed), or `null` when signed out. */
  getAccessToken: () => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Restores the persisted Supabase session on load and tracks auth changes. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseClient(), [])
  const service = useMemo(
    () => (supabase ? createAuthService(supabase, () => getAuthCallbackUrl(window.location.origin)) : null),
    [supabase]
  )
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<AuthStatus>(supabase ? "loading" : "not-configured")

  useEffect(() => {
    if (!supabase) return
    // INITIAL_SESSION is emitted with the session restored from storage.
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setStatus(next ? "signed-in" : "signed-out")
    })
    return () => data.subscription.unsubscribe()
  }, [supabase])

  const signOut = useCallback(async () => {
    await service?.signOut()
  }, [service])

  const getAccessToken = useCallback(async (): Promise<string | null> => {
    if (!supabase) return null
    // getSession refreshes an expired access token before returning it.
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  }, [supabase])

  const checkSession = useCallback(async (): Promise<SessionCheck> => {
    if (!supabase) return { state: "error" }
    const token = await getAccessToken()
    if (!token) return { state: "signed-out" }
    const check = interpretSessionCheck(await apiRequest<AuthSessionResponse>("/auth/session", token))
    if (shouldEndSession(check)) await signOut()
    return check
  }, [supabase, signOut, getAccessToken])

  const value = useMemo(
    () => ({ status, session, service, checkSession, getAccessToken, signOut }),
    [status, session, service, checkSession, getAccessToken, signOut]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside <AuthProvider>")
  return value
}
