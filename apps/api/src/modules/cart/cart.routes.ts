import { CART_ERROR_CODES, cartItemAcceptPriceSchema, cartItemAddSchema, cartItemUpdateSchema } from "@chicman/shared";
import { Router, type Request } from "express";

import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { idParam } from "../products/product.routes.js";
import type { CartService } from "./cart.service.js";

export interface CartDependencies {
  cart: CartService;
  rateLimiter: RateLimiter;
}

/** Cart changes. Generous, because each press of a quantity control is one request. */
export const CART_WRITE_RATE_LIMIT: RateLimitRule = { name: "cart-write", perUser: 300, perIp: 600, windowMs: 10 * 60_000 };

const itemId = (req: Request): string => idParam(req.params["itemId"], CART_ERROR_CODES.itemNotFound);

/**
 * `/api/v1/customers/me/cart` (spec 09). Bootstrapped users only: the owner comes
 * from the verified token, never from the request. Every route answers with the
 * whole recalculated cart, so a client always shows what the server worked out.
 */
export function createCartRouter(guards: AuthGuards, deps: CartDependencies): Router {
  const router = Router();
  const write = [...guards.user, rateLimit(deps.rateLimiter, CART_WRITE_RATE_LIMIT)];

  router.get("/customers/me/cart", ...guards.user, async (req, res) => {
    res.status(200).json(await deps.cart.read(requireLoadedUser(req).id));
  });

  router.delete("/customers/me/cart", ...write, async (req, res) => {
    res.status(200).json(await deps.cart.clear(requireLoadedUser(req).id));
  });

  router.post("/customers/me/cart/items", ...write, async (req, res) => {
    const user = requireLoadedUser(req);
    res.status(200).json(await deps.cart.addItem(user.id, parseOrBadRequest(cartItemAddSchema, req.body)));
  });

  router.patch("/customers/me/cart/items/:itemId", ...write, async (req, res) => {
    const user = requireLoadedUser(req);
    const { quantity } = parseOrBadRequest(cartItemUpdateSchema, req.body);
    res.status(200).json(await deps.cart.updateQuantity(user.id, itemId(req), quantity));
  });

  router.post("/customers/me/cart/items/:itemId/accept-price", ...write, async (req, res) => {
    const user = requireLoadedUser(req);
    const { price } = parseOrBadRequest(cartItemAcceptPriceSchema, req.body);
    res.status(200).json(await deps.cart.acceptPrice(user.id, itemId(req), price));
  });

  router.delete("/customers/me/cart/items/:itemId", ...write, async (req, res) => {
    res.status(200).json(await deps.cart.removeItem(requireLoadedUser(req).id, itemId(req)));
  });

  return router;
}
