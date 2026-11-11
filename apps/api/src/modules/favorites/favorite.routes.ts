import { PRODUCT_ERROR_CODES } from "@chicman/shared";
import { Router, type Request } from "express";

import type { RateLimiter } from "../../lib/rate-limiter.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { idParam } from "../products/product.routes.js";
import type { FavoriteService } from "./favorite.service.js";

export interface FavoriteDependencies {
  favorites: FavoriteService;
  rateLimiter: RateLimiter;
}

/** Favorite changes. Generous, because each tap on a heart is one request. */
export const FAVORITE_WRITE_RATE_LIMIT: RateLimitRule = { name: "favorite-write", perUser: 300, perIp: 600, windowMs: 10 * 60_000 };

const productId = (req: Request): string => idParam(req.params["productId"], PRODUCT_ERROR_CODES.notFound);

/**
 * `/api/v1/customers/me/favorites` (spec 14). Bootstrapped users only: the owner
 * comes from the verified token, never from the request, so no route can read or
 * change another customer's list. `PUT` and `DELETE` are idempotent, and every
 * route answers with the whole list.
 */
export function createFavoriteRouter(guards: AuthGuards, deps: FavoriteDependencies): Router {
  const router = Router();
  const write = [...guards.user, rateLimit(deps.rateLimiter, FAVORITE_WRITE_RATE_LIMIT)];

  router.get("/customers/me/favorites", ...guards.user, async (req, res) => {
    res.status(200).json(await deps.favorites.list(requireLoadedUser(req).id));
  });

  router.put("/customers/me/favorites/:productId", ...write, async (req, res) => {
    res.status(200).json(await deps.favorites.add(requireLoadedUser(req).id, productId(req)));
  });

  router.delete("/customers/me/favorites/:productId", ...write, async (req, res) => {
    res.status(200).json(await deps.favorites.remove(requireLoadedUser(req).id, productId(req)));
  });

  return router;
}
