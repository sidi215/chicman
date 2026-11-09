import {
  CHECKOUT_ERROR_CODES,
  checkoutPlacementSchema,
  checkoutSummaryQuerySchema,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeySchema,
} from "@chicman/shared";
import { Router } from "express";

import { badRequest } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { CheckoutService } from "./checkout.service.js";

/** Server configuration values (S2-6), not business rules: `CHECKOUT_RATE_LIMIT_*`. */
export interface CheckoutRateLimitConfig {
  perUser: number;
  perIp: number;
  windowMs: number;
}

export interface CheckoutDependencies {
  checkout: CheckoutService;
  rateLimiter: RateLimiter;
  rateLimit: CheckoutRateLimitConfig;
}

/**
 * `/api/v1/customers/me/checkout` (spec 10). Bootstrapped users only; the
 * customer comes from the verified token, never from the request. The summary
 * follows the cart's read rules; placement has its own limit.
 */
export function createCheckoutRouter(guards: AuthGuards, deps: CheckoutDependencies): Router {
  const router = Router();
  const placementLimit: RateLimitRule = { name: "checkout-place", ...deps.rateLimit };

  router.get("/customers/me/checkout", ...guards.user, async (req, res) => {
    const user = requireLoadedUser(req);
    const { addressId } = parseOrBadRequest(checkoutSummaryQuerySchema, { ...req.query });
    res.status(200).json(await deps.checkout.summary(user.id, addressId));
  });

  router.post("/customers/me/checkout", ...guards.user, rateLimit(deps.rateLimiter, placementLimit), async (req, res) => {
    const user = requireLoadedUser(req);
    const key = idempotencyKeySchema.safeParse(req.get(IDEMPOTENCY_KEY_HEADER));
    if (!key.success) throw badRequest(CHECKOUT_ERROR_CODES.idempotencyKeyInvalid);
    const input = parseOrBadRequest(checkoutPlacementSchema, req.body);
    const { created, order } = await deps.checkout.place(user.id, key.data.toLowerCase(), input);
    res.status(created ? 201 : 200).json(order);
  });

  return router;
}
