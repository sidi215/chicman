import type { Role } from "@chicman/shared";
import type { RequestHandler } from "express";

import { authenticate } from "../../middleware/authenticate.js";
import { loadAppUser, requireAppUser, requireRole } from "../../middleware/authorize.js";
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
 * Middleware chains in the order required by spec 03:
 * verify token → load user and roles from PostgreSQL → role check →
 * resource or ownership check.
 */
export interface AuthGuards {
  /** Verified token, user loaded (may be `null`). Only for account bootstrap (spec 04). */
  tokenOnly: RequestHandler[];
  /** Verified token and a bootstrapped application user. */
  user: RequestHandler[];
  /** Bootstrapped user holding at least one of the roles. */
  role: (...roles: Role[]) => RequestHandler[];
  /** Normal seller operations: SELLER + owned shop + `Shop.status = APPROVED`. */
  approvedSeller: RequestHandler[];
}

export function createAuthGuards({ verifier, users, shops }: AuthDependencies): AuthGuards {
  const tokenOnly = [authenticate(verifier), loadAppUser(users)];
  const user = [...tokenOnly, requireAppUser];
  return {
    tokenOnly,
    user,
    role: (...roles) => [...user, requireRole(...roles)],
    approvedSeller: [...user, requireApprovedSeller(shops)],
  };
}
