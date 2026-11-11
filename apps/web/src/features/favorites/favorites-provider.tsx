"use client"

import type { FavoriteList } from "@chicman/shared"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useAuth } from "@/features/auth/auth-provider"
import { apiRequest } from "@/lib/api-client"

import {
  addFavoriteRequest,
  createRequestQueue,
  favoriteIds,
  FAVORITES_PATH,
  interpretFavoriteResult,
  removeFavoriteRequest,
  type FavoriteFailure,
  type FavoriteOutcome,
} from "./favorites-logic"

export type FavoritesState =
  { kind: "loading" } | { kind: "guest" } | { kind: "needs-setup" } | { kind: "ready"; list: FavoriteList } | { kind: "failed"; failure: FavoriteFailure }

interface Request {
  path: string
  init?: RequestInit
}

interface FavoritesContextValue {
  state: FavoritesState
  /** Empty until the list is known. */
  ids: ReadonlySet<string>
  /** Products in the signed-in customer's list, each once; `0` until the list is known and after sign-out. */
  count: number
  /** The product whose change is in flight, so its heart can wait. */
  pendingIds: ReadonlySet<string>
  reload: () => Promise<void>
  /** Each resolves to `null`, or the failure to show the customer. */
  add: (productId: string) => Promise<FavoriteFailure | null>
  remove: (productId: string) => Promise<FavoriteFailure | null>
}

const FavoritesContext = createContext<FavoritesContextValue | null>(null)
const NO_IDS: ReadonlySet<string> = new Set()

/**
 * Holds the signed-in customer's favorites for the hearts and the favorites
 * page, the same way `CartProvider` holds the cart: every change shows the list
 * the API returns, and answers meant for a previous account are dropped.
 */
export function FavoritesProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken, signOut } = useAuth()
  const [loaded, setLoaded] = useState<FavoritesState>({ kind: "loading" })
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(NO_IDS)

  const send = useCallback(
    async ({ path, init }: Request): Promise<FavoriteOutcome> => {
      const token = await getAccessToken()
      if (token === null) return { state: "signed-out" }
      return interpretFavoriteResult(await apiRequest<FavoriteList>(path, token, init))
    },
    [getAccessToken]
  )

  const show = useCallback((outcome: FavoriteOutcome) => {
    if (outcome.state === "ok") setLoaded({ kind: "ready", list: outcome.list })
    else if (outcome.state === "not-bootstrapped") setLoaded({ kind: "needs-setup" })
    else if (outcome.state === "signed-out") setLoaded({ kind: "guest" })
    else setLoaded({ kind: "failed", failure: outcome.failure })
  }, [])

  // Moves on when the session ends, so answers to the previous account's requests are dropped.
  const account = useRef(0)
  // One list request at a time per account (see `createRequestQueue`).
  const queue = useRef(createRequestQueue())

  /** Queued for the current account; dropped unsent if the account changes before its turn. */
  const queued = useCallback(
    (request: Request): Promise<FavoriteOutcome | null> => {
      const started = account.current
      return queue.current.run(async () => {
        if (started !== account.current) return null
        const outcome = await send(request)
        // Only the account that made the request may be signed out by its answer.
        if (outcome.state === "signed-out" && started === account.current) void signOut()
        return outcome
      })
    },
    [send, signOut]
  )

  const reload = useCallback(async () => {
    const started = account.current
    const outcome = await queued({ path: FAVORITES_PATH })
    if (outcome !== null && started === account.current) show(outcome)
  }, [queued, show])

  useEffect(() => {
    if (status !== "signed-in") return
    void reload()
    return () => {
      account.current += 1
      // The next account never waits behind this one's requests.
      queue.current = createRequestQueue()
      // Never show one account's favorites to the next account signing in.
      setLoaded({ kind: "loading" })
      setPendingIds(NO_IDS)
    }
  }, [status, reload])

  const change = useCallback(
    async (productId: string, request: Request): Promise<FavoriteFailure | null> => {
      const started = account.current
      setPendingIds((ids) => new Set(ids).add(productId))
      const outcome = await queued(request)
      if (outcome === null || started !== account.current) return null
      setPendingIds((ids) => {
        const next = new Set(ids)
        next.delete(productId)
        return next
      })
      if (outcome.state === "failed") {
        // Keep what is on screen: a refused change leaves the list as it was.
        return outcome.failure
      }
      show(outcome)
      return outcome.state === "ok" ? null : "error"
    },
    [queued, show]
  )

  const state: FavoritesState = useMemo(() => {
    if (status === "signed-in") return loaded
    return status === "loading" ? { kind: "loading" } : { kind: "guest" }
  }, [status, loaded])

  const ids = useMemo(() => (state.kind === "ready" ? favoriteIds(state.list) : NO_IDS), [state])

  const value = useMemo<FavoritesContextValue>(
    () => ({
      state,
      ids,
      count: ids.size,
      pendingIds,
      reload,
      add: (productId) => change(productId, addFavoriteRequest(productId)),
      remove: (productId) => change(productId, removeFavoriteRequest(productId)),
    }),
    [state, ids, pendingIds, reload, change]
  )
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>
}

export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext)
  if (value === null) throw new Error("useFavorites must be used inside <FavoritesProvider>")
  return value
}
