import type { RequestHandler } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { loadAppUser, requireAccountType, requireAppUser } from "../../middleware/authorize.js";
import { requireApprovedSeller } from "../../middleware/require-approved-seller.js";
import type { ShopAccessRepository } from "../shops/shop-access.repository.js";
import type { UserRepository } from "../users/user.repository.js";
import type { TokenVerifier } from "./token-verifier.js";

export interface AuthDependencies {
  verifier: TokenVerifier;
  users: UserRepository;
  shops: ShopAccessRepository;
}

/**
 * Middleware chains in the order required by spec 03 and AT-1:
 * verify token → load the account and its type from PostgreSQL → type check →
 * resource or ownership check.
 */
export interface AuthGuards {
  /** Verified token, account loaded (may be `null`). Only for account setup (AT-1). */
  tokenOnly: RequestHandler[];
  /** Verified token and an account of any type (session, own profile). */
  user: RequestHandler[];
  /** Buyer accounts only: addresses, cart, checkout, favorites, own orders. */
  buyer: RequestHandler[];
  /** Seller accounts only, any shop status (the owner shop routes add their status rules). */
  seller: RequestHandler[];
  /** Buyer or Seller accounts: the notification inbox (no administrator audience, O6.1). */
  buyerOrSeller: RequestHandler[];
  /** Normal seller operations: Seller account + owned shop + `Shop.status = APPROVED`. */
  approvedSeller: RequestHandler[];
  /** Administrator accounts with active administrative access only. */
  admin: RequestHandler[];
}

export function createAuthGuards({ verifier, users, shops }: AuthDependencies): AuthGuards {
  const tokenOnly = [authenticate(verifier), loadAppUser(users)];
  const user = [...tokenOnly, requireAppUser];
  return {
    tokenOnly,
    user,
    buyer: [...user, requireAccountType("BUYER")],
    seller: [...user, requireAccountType("SELLER")],
    buyerOrSeller: [...user, requireAccountType("BUYER", "SELLER")],
    approvedSeller: [...user, requireAccountType("SELLER"), requireApprovedSeller(shops)],
    admin: [...user, requireAccountType("ADMIN")],
  };
}
