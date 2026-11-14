import { createHash } from "node:crypto";

import type { AccountType, Role, ShopStatus } from "@chicman/shared";

/**
 * Classification of existing accounts into AT-1 account types
 * (`context/account-types-audit.md`, section 11.2). Pure: the operator script
 * loads the snapshots, prints the plan for the owner's review, and writes
 * only the reviewed plan (its digest must match).
 *
 * Rule: any `ADMIN` → Administrator; else `SELLER` or a shop owner → Seller;
 * else `CUSTOMER` → Buyer. Nothing is deleted, transferred, or hidden here:
 * data that does not fit the new type is only reported (Q8, Q9).
 */

export interface AccountSnapshot {
  userId: string;
  supabaseUserId: string;
  roles: readonly Role[];
  /** Set once already (by a previous run, setup, or provisioning). */
  accountType: AccountType | null;
  hasProfile: boolean;
  shop: { status: ShopStatus; products: number; shopOrders: number } | null;
  buyer: { orders: number; addresses: number; cartItems: number; favorites: number };
  notifications: number;
}

/** Data the account keeps but its new type will not reach (reported, never changed). */
export type IncompatibleData =
  | "SHOP_OWNED_BY_ADMIN"
  | "BUYER_ORDERS"
  | "BUYER_ADDRESSES"
  | "BUYER_CART"
  | "BUYER_FAVORITES"
  | "NOTIFICATIONS_WITHOUT_INBOX";

export type Classification =
  | { kind: "classify"; accountType: AccountType; incompatible: IncompatibleData[] }
  /** Already typed, and the rule agrees: nothing to write. */
  | { kind: "unchanged"; accountType: AccountType; incompatible: IncompatibleData[] }
  /** The rule cannot decide, or disagrees with a type already set: the plan cannot be applied. */
  | { kind: "blocked"; reason: "NO_ROLE" | "TYPE_ALREADY_DIFFERENT"; proposed: AccountType | null };

export function proposedAccountType(account: Pick<AccountSnapshot, "roles" | "shop">): AccountType | null {
  if (account.roles.includes("ADMIN")) return "ADMIN";
  if (account.roles.includes("SELLER") || account.shop !== null) return "SELLER";
  if (account.roles.includes("CUSTOMER")) return "BUYER";
  return null;
}

export function incompatibleData(account: AccountSnapshot, type: AccountType): IncompatibleData[] {
  const found: IncompatibleData[] = [];
  if (type === "ADMIN" && account.shop !== null) found.push("SHOP_OWNED_BY_ADMIN");
  if (type !== "BUYER") {
    if (account.buyer.orders > 0) found.push("BUYER_ORDERS");
    if (account.buyer.addresses > 0) found.push("BUYER_ADDRESSES");
    if (account.buyer.cartItems > 0) found.push("BUYER_CART");
    if (account.buyer.favorites > 0) found.push("BUYER_FAVORITES");
  }
  if (type === "ADMIN" && account.notifications > 0) found.push("NOTIFICATIONS_WITHOUT_INBOX");
  return found;
}

export function classifyAccount(account: AccountSnapshot): Classification {
  const proposed = proposedAccountType(account);
  if (proposed === null) return { kind: "blocked", reason: "NO_ROLE", proposed: null };
  if (account.accountType !== null && account.accountType !== proposed) {
    return { kind: "blocked", reason: "TYPE_ALREADY_DIFFERENT", proposed };
  }
  const incompatible = incompatibleData(account, proposed);
  return account.accountType === null
    ? { kind: "classify", accountType: proposed, incompatible }
    : { kind: "unchanged", accountType: proposed, incompatible };
}

export interface ClassificationPlan {
  entries: { account: AccountSnapshot; result: Classification }[];
  /** Accounts that would be written (`classify` only). */
  writes: { userId: string; accountType: AccountType }[];
  blocked: number;
  /** SHA-256 of the writes, in user ID order: the owner approves this exact value. */
  digest: string;
}

export function buildClassificationPlan(accounts: readonly AccountSnapshot[]): ClassificationPlan {
  const sorted = [...accounts].sort((a, b) => a.userId.localeCompare(b.userId));
  const entries = sorted.map((account) => ({ account, result: classifyAccount(account) }));
  const writes = entries.flatMap(({ account, result }) => (result.kind === "classify" ? [{ userId: account.userId, accountType: result.accountType }] : []));
  const blocked = entries.filter(({ result }) => result.kind === "blocked").length;
  const digest = createHash("sha256")
    .update(writes.map((write) => `${write.userId}:${write.accountType}`).join("\n"))
    .digest("hex");
  return { entries, writes, blocked, digest };
}
