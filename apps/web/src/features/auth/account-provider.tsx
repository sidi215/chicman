"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"

import { accountFromSessionCheck, type AccountState } from "./account"
import { useAuth } from "./auth-provider"

interface AccountContextValue {
  account: AccountState
  /** Reads the session again (after account setup); the last known state stays meanwhile. */
  refresh: () => Promise<AccountState>
}

const AccountContext = createContext<AccountContextValue | null>(null)

/**
 * The signed-in account and its type (AT-1), read from `GET /auth/session` on
 * sign-in. Every area gate, the header, and the buyer providers route with it;
 * the API authorizes every request on its own. An answer for a previous
 * account is dropped, so one account's type never applies to the next.
 */
export function AccountProvider({ children }: { children: ReactNode }) {
  const { status, checkSession } = useAuth()
  const [account, setAccount] = useState<AccountState>({ state: "loading" })
  const generation = useRef(0)

  const read = useCallback(async (): Promise<AccountState | null> => {
    const started = generation.current
    const next = accountFromSessionCheck(await checkSession())
    return started === generation.current ? next : null
  }, [checkSession])

  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void read().then((next) => {
      if (!cancelled && next !== null) setAccount(next)
    })
    return () => {
      cancelled = true
      generation.current += 1
      setAccount({ state: "loading" })
    }
  }, [status, read])

  const refresh = useCallback(async (): Promise<AccountState> => {
    const next = await read()
    if (next === null) return { state: "loading" }
    setAccount(next)
    return next
  }, [read])

  const value: AccountContextValue = {
    account: status === "signed-in" ? account : status === "loading" ? { state: "loading" } : { state: "guest" },
    refresh,
  }
  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>
}

export function useAccount(): AccountContextValue {
  const value = useContext(AccountContext)
  if (value === null) throw new Error("useAccount must be used inside <AccountProvider>")
  return value
}
