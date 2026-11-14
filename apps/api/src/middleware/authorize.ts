import type { AccountType } from "@chicman/shared";
import type { Request, RequestHandler } from "express";

import { forbidden } from "../lib/http-error.js";
import { AuthenticationError } from "../modules/auth/auth.errors.js";
import type { AppUser, UserRepository } from "../modules/users/user.repository.js";

/**
 * Step 2: load the application account and its type from PostgreSQL by the
 * verified `sub`. The type is never taken from token claims or request data.
 * Sets `req.appUser` (`null` before bootstrap).
 */
export function loadAppUser(users: UserRepository): RequestHandler {
  return async (req, _res, next) => {
    if (req.auth === undefined) throw new AuthenticationError("invalid");
    req.appUser = await users.findBySupabaseUserId(req.auth.supabaseUserId);
    next();
  };
}

/** Returns the loaded application user, or `403` before bootstrap. */
export function requireLoadedUser(req: Request): AppUser {
  if (req.auth === undefined) throw new AuthenticationError("invalid");
  if (req.appUser === undefined || req.appUser === null) throw forbidden();
  return req.appUser;
}

/**
 * A valid token without an application account has no type: only account
 * setup (AT-1) skips this guard. Every other protected route → `403`.
 */
export const requireAppUser: RequestHandler = (req, _res, next) => {
  requireLoadedUser(req);
  next();
};

/**
 * Step 3 (AT-1): the account must be of one of the given types. An
 * administrator whose administrative access was deactivated (Q7) is refused
 * wherever `ADMIN` is required; the account keeps its type.
 */
export function requireAccountType(...types: AccountType[]): RequestHandler {
  return (req, _res, next) => {
    const user = requireLoadedUser(req);
    if (!types.includes(user.accountType)) throw forbidden();
    if (user.accountType === "ADMIN" && user.adminAccessDeactivated) throw forbidden();
    next();
  };
}
