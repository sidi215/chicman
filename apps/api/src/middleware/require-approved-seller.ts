import { type RequestHandler } from "express";

import { forbidden } from "../lib/http-error.js";
import type { ShopAccessRepository } from "../modules/shops/shop-access.repository.js";
import { requireLoadedUser } from "./authorize.js";

/**
 * Step 4 for normal seller operations (products, inventory, seller orders,
 * delivery). Allowed only if the user holds `SELLER` **and** owns a shop
 * **and** that shop's `Shop.status` is `APPROVED`, all loaded server-side on
 * every request. Client-provided shop IDs, statuses, or roles are ignored.
 *
 * Sets `req.sellerShop`. Handlers scope every resource lookup to
 * `req.sellerShop.id`, so another shop's resources resolve to `404`.
 *
 * Not used for shop onboarding (spec 06).
 */
export function requireApprovedSeller(shops: ShopAccessRepository): RequestHandler {
  return async (req, _res, next) => {
    const user = requireLoadedUser(req);
    if (!user.roles.includes("SELLER")) throw forbidden();
    const shop = await shops.findByOwnerUserId(user.id);
    if (shop === null || shop.status !== "APPROVED") throw forbidden();
    req.sellerShop = shop;
    next();
  };
}
