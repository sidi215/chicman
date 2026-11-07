import { API_ERROR_CODES, AUTH_ERROR_CODES } from "@chicman/shared";
import { Router } from "express";

import { HttpError, notFound } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import { AuthenticationError } from "../auth/auth.errors.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { EmailConfirmationChecker } from "../auth/email-confirmation.js";
import type { CustomerRepository } from "./customer.repository.js";
import { parseBootstrapBody, parseProfileUpdate } from "./customer.schemas.js";

export interface CustomerDependencies {
  customers: CustomerRepository;
  emailConfirmation: EmailConfirmationChecker;
  rateLimiter: RateLimiter;
}

const TEN_MINUTES = 10 * 60_000;

/** Account bootstrap (account setup). */
export const BOOTSTRAP_RATE_LIMIT: RateLimitRule = { name: "bootstrap", perUser: 10, perIp: 60, windowMs: TEN_MINUTES };
/** Profile updates (including phone changes). */
export const PROFILE_UPDATE_RATE_LIMIT: RateLimitRule = {
  name: "profile-update",
  perUser: 20,
  perIp: 100,
  windowMs: TEN_MINUTES,
};

/** `/api/v1/customers` (spec 04). Every route targets the authenticated user. */
export function createCustomerRouter(guards: AuthGuards, deps: CustomerDependencies): Router {
  const router = Router();

  // Account setup. Token only: before bootstrap no application user exists.
  router.post("/customers/me", ...guards.tokenOnly, rateLimit(deps.rateLimiter, BOOTSTRAP_RATE_LIMIT), async (req, res) => {
    if (req.auth === undefined || req.accessToken === undefined) throw new AuthenticationError("invalid");
    const { phone } = parseBootstrapBody(req.body);

    // Server-side confirmation check; never client input or user_metadata.
    const confirmed = await deps.emailConfirmation.isEmailConfirmed(req.accessToken, req.auth.supabaseUserId);
    if (!confirmed) throw new HttpError(403, AUTH_ERROR_CODES.emailNotConfirmed);

    const { created, account } = await deps.customers.bootstrap(req.auth.supabaseUserId, phone);
    res.status(created ? 201 : 200).json(account);
  });

  router.get("/customers/me", ...guards.user, async (req, res) => {
    const user = requireLoadedUser(req);
    const account = await deps.customers.findByUserId(user.id);
    if (account === null) throw notFound(API_ERROR_CODES.profileNotFound);
    res.status(200).json(account);
  });

  router.patch("/customers/me", ...guards.user, rateLimit(deps.rateLimiter, PROFILE_UPDATE_RATE_LIMIT), async (req, res) => {
    const user = requireLoadedUser(req);
    const changes = parseProfileUpdate(req.body);
    const account = await deps.customers.update(user.id, changes);
    if (account === null) throw notFound(API_ERROR_CODES.profileNotFound);
    res.status(200).json(account);
  });

  return router;
}
