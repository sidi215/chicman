"use client"

import { usePathname } from "next/navigation"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useAuth } from "@/features/auth/auth-provider"
import { apiRequest } from "@/lib/api-client"

import { interpretNotificationResult, UNREAD_COUNT_PATH, type NotificationOutcome, type NotificationUnreadCount } from "./notifications-logic"

/** An answer that arrived after the account changed: dropped, never shown. */
export type GuardedNotificationOutcome<T> = NotificationOutcome<T> | { state: "stale" }

interface NotificationsContextValue {
  /** Unread notifications of the signed-in user; `0` for guests and until known. */
  unread: number
  /** Reads the count again. */
  refresh: () => Promise<void>
  /** Shows a count the page worked out after a successful change. */
  setUnread: (count: number) => void
  /** An authenticated call for the current account; a late answer for a previous account is `stale`. */
  call: <T>(path: string, init?: RequestInit) => Promise<GuardedNotificationOutcome<T>>
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null)

/**
 * Holds the unread count for the bell, with the cart provider's account-change
 * guard (`CartProvider`): an answer to a request made for a previous account
 * is dropped, so one account's count never shows for the next. The count is
 * read on sign-in, on each page change, and when the window regains focus;
 * nothing is pushed to the browser.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken, signOut } = useAuth()
  const pathname = usePathname()
  const [unread, setUnreadState] = useState(0)
  // Moves on when the session ends.
  const account = useRef(0)

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<GuardedNotificationOutcome<T>> => {
      const started = account.current
      const token = await getAccessToken()
      if (started !== account.current) return { state: "stale" }
      if (token === null) return { state: "signed-out" }
      const outcome = interpretNotificationResult(await apiRequest<T>(path, token, init))
      if (started !== account.current) return { state: "stale" }
      // Only the account that made the request may be signed out by its answer.
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )

  const refresh = useCallback(async () => {
    const outcome = await call<NotificationUnreadCount>(UNREAD_COUNT_PATH)
    // A failed read keeps the last known count rather than inventing one.
    if (outcome.state === "ok") setUnreadState(outcome.data.unread)
  }, [call])

  useEffect(() => {
    if (status !== "signed-in") return
    const onFocus = () => void refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      window.removeEventListener("focus", onFocus)
      account.current += 1
      // Never show one account's count to the next account signing in.
      setUnreadState(0)
    }
  }, [status, refresh])

  // On sign-in and on each page change.
  useEffect(() => {
    if (status !== "signed-in") return
    let cancelled = false
    void call<NotificationUnreadCount>(UNREAD_COUNT_PATH).then((outcome) => {
      if (!cancelled && outcome.state === "ok") setUnreadState(outcome.data.unread)
    })
    return () => {
      cancelled = true
    }
  }, [status, call, pathname])

  const value = useMemo<NotificationsContextValue>(
    () => ({ unread: status === "signed-in" ? unread : 0, refresh, setUnread: setUnreadState, call }),
    [status, unread, refresh, call]
  )
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
}

export function useNotifications(): NotificationsContextValue {
  const value = useContext(NotificationsContext)
  if (value === null) throw new Error("useNotifications must be used inside <NotificationsProvider>")
  return value
}
