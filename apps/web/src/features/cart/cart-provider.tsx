"use client"

import type { Cart, CartItemAddInput } from "@chicman/shared"
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { useAuth } from "@/features/auth/auth-provider"
import { apiRequest } from "@/lib/api-client"

import { acceptPriceRequest, addItemRequest, CART_PATH, interpretCartResult, removeItemRequest, setQuantityRequest, type CartFailure, type CartOutcome } from "./cart-logic"

export type CartState =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "needs-setup" }
  | { kind: "ready"; cart: Cart }
  | { kind: "failed"; failure: CartFailure }

interface Request {
  path: string
  init?: RequestInit
}

interface CartContextValue {
  state: CartState
  /** Units across all lines; `0` until a cart is known. */
  itemCount: number
  /** Reads the cart again, so the server recalculates it. */
  reload: () => Promise<void>
  /** Each resolves to `null`, or the failure to show the customer. */
  addItem: (input: CartItemAddInput) => Promise<CartFailure | null>
  setQuantity: (itemId: string, quantity: number) => Promise<CartFailure | null>
  acceptPrice: (itemId: string, price: string) => Promise<CartFailure | null>
  removeItem: (itemId: string) => Promise<CartFailure | null>
}

const CartContext = createContext<CartContextValue | null>(null)

/**
 * Holds the signed-in customer's cart for the header and the cart page. Every
 * change shows the cart the API returns, and a refused change reads it again,
 * since a refusal usually means the product changed since it was shown.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { status, getAccessToken, signOut } = useAuth()
  const [loaded, setLoaded] = useState<CartState>({ kind: "loading" })

  const send = useCallback(
    async ({ path, init }: Request): Promise<CartOutcome> => {
      const token = await getAccessToken()
      if (token === null) return { state: "signed-out" }
      const outcome = interpretCartResult(await apiRequest<Cart>(path, token, init))
      if (outcome.state === "signed-out") void signOut()
      return outcome
    },
    [getAccessToken, signOut]
  )

  const show = useCallback((outcome: CartOutcome) => {
    if (outcome.state === "ok") setLoaded({ kind: "ready", cart: outcome.cart })
    else if (outcome.state === "not-bootstrapped") setLoaded({ kind: "needs-setup" })
    else if (outcome.state === "signed-out") setLoaded({ kind: "guest" })
    else setLoaded({ kind: "failed", failure: outcome.failure })
  }, [])

  // Moves on when the session ends, so answers to the previous account's requests are dropped.
  const account = useRef(0)

  const reload = useCallback(async () => {
    const started = account.current
    const outcome = await send({ path: CART_PATH })
    if (started === account.current) show(outcome)
  }, [send, show])

  useEffect(() => {
    if (status !== "signed-in") return
    void reload()
    return () => {
      account.current += 1
      // Never show one account's cart to the next account signing in.
      setLoaded({ kind: "loading" })
    }
  }, [status, reload])

  const change = useCallback(
    async (request: Request): Promise<CartFailure | null> => {
      const started = account.current
      const outcome = await send(request)
      if (started !== account.current) return null
      if (outcome.state === "failed") {
        // The change was refused, but what is on screen may still be valid.
        const current = await send({ path: CART_PATH })
        if (started === account.current && current.state === "ok") show(current)
        return outcome.failure
      }
      show(outcome)
      // Otherwise the session or the account is the problem, and the page now shows that.
      return outcome.state === "ok" ? null : "error"
    },
    [send, show]
  )

  const state: CartState = useMemo(() => {
    if (status === "signed-in") return loaded
    return status === "loading" ? { kind: "loading" } : { kind: "guest" }
  }, [status, loaded])

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      itemCount: state.kind === "ready" ? state.cart.itemCount : 0,
      reload,
      addItem: (input) => change(addItemRequest(input)),
      setQuantity: (itemId, quantity) => change(setQuantityRequest(itemId, quantity)),
      acceptPrice: (itemId, price) => change(acceptPriceRequest(itemId, price)),
      removeItem: (itemId) => change(removeItemRequest(itemId)),
    }),
    [state, reload, change]
  )
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext)
  if (value === null) throw new Error("useCart must be used inside <CartProvider>")
  return value
}
