import type { Role } from "@chicman/shared";
import type { Request, RequestHandler } from "express";

import { forbidden } from "../lib/http-error.js";
import { AuthenticationError } from "../modules/auth/auth.errors.js";
import type { AppUser, UserRepository } from "../modules/users/user.repository.js";

/**
 * Step 2: load the application user and roles from PostgreSQL by the
 * verified `sub`. Roles are never taken from token claims or request data.
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
 * A valid token without an application user has no role: only the bootstrap
 * endpoint (spec 04) skips this guard. Every other protected route → `403`.
 */
export const requireAppUser: RequestHandler = (req, _res, next) => {
  requireLoadedUser(req);
  next();
};

/** Step 3: the user must hold at least one of the given roles. */
export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    const user = requireLoadedUser(req);
    if (!roles.some((role) => user.roles.includes(role))) throw forbidden();
    next();
  };
}
