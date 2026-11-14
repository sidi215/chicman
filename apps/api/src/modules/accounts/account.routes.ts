import { ACCOUNT_ERROR_CODES, API_ERROR_CODES, AUTH_ERROR_CODES, type RegistrationIntentResponse } from "@chicman/shared";
import { Router } from "express";

import { HttpError, notFound } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import { AuthenticationError } from "../auth/auth.errors.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { EmailConfirmationChecker } from "../auth/email-confirmation.js";
import type { AccountRepository } from "./account.repository.js";
import { parseIntentBody, parseProfileUpdate, parseSetupBody } from "./account.schemas.js";

export interface AccountDependencies {
  accounts: AccountRepository;
  emailConfirmation: EmailConfirmationChecker;
  rateLimiter: RateLimiter;
}

const TEN_MINUTES = 10 * 60_000;

/** Registration intents: no session exists yet, so per client IP only. */
export const REGISTRATION_INTENT_RATE_LIMIT: RateLimitRule = { name: "registration-intent", perUser: 10, perIp: 30, windowMs: TEN_MINUTES };
/** Account setup. */
export const SETUP_RATE_LIMIT: RateLimitRule = { name: "bootstrap", perUser: 10, perIp: 60, windowMs: TEN_MINUTES };
/** Profile updates (including phone changes). */
export const PROFILE_UPDATE_RATE_LIMIT: RateLimitRule = { name: "profile-update", perUser: 20, perIp: 100, windowMs: TEN_MINUTES };

/**
 * Accounts (AT-1, `context/account-types-audit.md` section 5; spec 04).
 * The account type comes only from the identity's registration intent, set
 * once right after sign-up; no route accepts a type, role, or `ADMIN`.
 */
export function createAccountRouter(guards: AuthGuards, deps: AccountDependencies): Router {
  const router = Router();

  // Before any session exists (section 5.3). Write-once; the same answer
  // whether or not the identity exists, so it reveals nothing.
  router.post("/registration-intents", rateLimit(deps.rateLimiter, REGISTRATION_INTENT_RATE_LIMIT), async (req, res) => {
    const { supabaseUserId, accountType } = parseIntentBody(req.body);
    const outcome = await deps.accounts.recordIntent(supabaseUserId, accountType);
    if (outcome === "conflict") throw new HttpError(409, ACCOUNT_ERROR_CODES.registrationIntentConflict);
    res.status(204).end();
  });

  // The identity's own intent (verified token; no account needed yet).
  router.get("/registration-intents/me", ...guards.tokenOnly, async (req, res) => {
    if (req.auth === undefined) throw new AuthenticationError("invalid");
    const response: RegistrationIntentResponse = { accountType: await deps.accounts.findIntent(req.auth.supabaseUserId) };
    res.status(200).json(response);
  });

  // Account setup. Token only: before setup no account exists.
  router.post("/accounts/me/setup", ...guards.tokenOnly, rateLimit(deps.rateLimiter, SETUP_RATE_LIMIT), async (req, res) => {
    if (req.auth === undefined || req.accessToken === undefined) throw new AuthenticationError("invalid");

    // Server-side confirmation check; never client input or user_metadata.
    const confirmed = await deps.emailConfirmation.isEmailConfirmed(req.accessToken, req.auth.supabaseUserId);
    if (!confirmed) throw new HttpError(403, AUTH_ERROR_CODES.emailNotConfirmed);

    const intent = await deps.accounts.findIntent(req.auth.supabaseUserId);
    const existing = req.appUser ?? null;
    if (existing !== null) {
      // Already set up (or provisioned): the same account again, unless the intent names another type.
      if (intent !== null && intent !== existing.accountType) throw new HttpError(409, ACCOUNT_ERROR_CODES.accountTypeConflict);
      const account = await deps.accounts.findByUserId(existing.id);
      if (account === null) throw notFound(API_ERROR_CODES.profileNotFound);
      res.status(200).json(account);
      return;
    }
    if (intent === null) throw new HttpError(409, ACCOUNT_ERROR_CODES.registrationIntentRequired);

    const { created, account } = await deps.accounts.setup(req.auth.supabaseUserId, parseSetupBody(intent, req.body));
    res.status(created ? 201 : 200).json(account);
  });

  // The own personal profile, for every account type (Q2).
  router.get("/accounts/me", ...guards.user, async (req, res) => {
    const account = await deps.accounts.findByUserId(requireLoadedUser(req).id);
    if (account === null) throw notFound(API_ERROR_CODES.profileNotFound);
    res.status(200).json(account);
  });

  router.patch("/accounts/me", ...guards.user, rateLimit(deps.rateLimiter, PROFILE_UPDATE_RATE_LIMIT), async (req, res) => {
    const user = requireLoadedUser(req);
    const changes = parseProfileUpdate(req.body);
    const account = await deps.accounts.update(user.id, changes);
    if (account === null) throw notFound(API_ERROR_CODES.profileNotFound);
    res.status(200).json(account);
  });

  return router;
}
