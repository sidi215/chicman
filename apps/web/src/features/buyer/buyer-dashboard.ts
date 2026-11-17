import type { CustomerAddress, CustomerOrderListItem } from "@chicman/shared"

import type { AccountState } from "@/features/auth/account"
import { CUSTOMER_ORDERS_PATH } from "@/features/orders/order-logic"
import { withoutLocale } from "@/lib/locale"

/**
 * Buyer dashboard shell (`/account`): its areas, where the shell is shown, and
 * the existing API reads behind the overview. It only decides what to show;
 * every page gates itself (`AccountGate`) and every API route enforces its own
 * rules.
 */

export const BUYER_AREAS = ["overview", "orders", "favorites", "addresses", "notifications", "profile"] as const
export type BuyerArea = (typeof BUYER_AREAS)[number]

export const BUYER_AREA_HREF: Record<BuyerArea, string> = {
  overview: "/account",
  orders: "/account/orders",
  favorites: "/account/favorites",
  addresses: "/account/addresses",
  notifications: "/account/notifications",
  profile: "/account/profile",
}

/** The area a path belongs to, with or without a locale prefix; `null` outside the dashboard (including `/account/setup`). */
export function buyerAreaOf(pathname: string): BuyerArea | null {
  const path = withoutLocale(pathname).replace(/\/+$/, "")
  if (path === "/account") return "overview"
  const segment = /^\/account\/([^/]+)/.exec(path)?.[1]
  return segment !== undefined && segment !== "overview" && (BUYER_AREAS as readonly string[]).includes(segment) ? (segment as BuyerArea) : null
}

/**
 * Whether `/account/*` shows the buyer shell: for a Buyer, and while the
 * account is still being read (most visitors here are buyers). Never without
 * an account (setup), and not for a Seller or an Administrator on the profile
 * page, which every type shares (Q2). Other pages send those away anyway.
 */
export function showsBuyerShell(account: AccountState): boolean {
  if (account.state === "active") return account.accountType === "BUYER"
  return account.state !== "needs-setup"
}

/** How many recent orders the overview lists. */
export const RECENT_ORDER_COUNT = 3
export const RECENT_ORDERS_PATH = `${CUSTOMER_ORDERS_PATH}?page=1&pageSize=${RECENT_ORDER_COUNT}`
export const ADDRESSES_PATH = "/customers/me/addresses"

/** The default address; the list puts it first, but the flag decides. */
export function defaultAddress(addresses: readonly CustomerAddress[]): CustomerAddress | null {
  return addresses.find((address) => address.isDefault) ?? null
}

/** One line for an address: its label when the customer gave one, else the district and city. */
export function addressLine(address: CustomerAddress): string {
  const place = `${address.district}, ${address.city}`
  return address.label === null || address.label.trim() === "" ? place : `${address.label} · ${place}`
}

/** Shop orders still moving: waiting for the seller, or confirmed and not yet finished. */
export function openShopOrderCount(orders: readonly CustomerOrderListItem[]): number {
  return orders.reduce((total, order) => total + order.shopOrders.filter(({ status }) => status === "PENDING" || status === "CONFIRMED").length, 0)
}

/** The first name for the greeting, or `null` without a name. */
export function greetingName(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0]
  return first === undefined || first === "" ? null : first
}
