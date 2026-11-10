import type { RequestHandler } from "express";

import { forbidden } from "../../lib/http-error.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import type { ShopAccessRepository } from "../shops/shop-access.repository.js";

/**
 * The narrow delivery guard (spec 12, section 8; D8), for "delivered, cash
 * received", failure, closure, and the in-progress list only. Allowed if the
 * user holds `SELLER`, owns a shop, and that shop is `APPROVED` or
 * `SUSPENDED`, all loaded server-side. The delivery-state part of the rule
 * (a suspended shop may act only on a delivery out for delivery, or failed
 * and not closed) is checked by `DeliveryLifecycle` under the row locks.
 *
 * Sets `req.sellerShop`. `requireApprovedSeller` is not loosened: every other
 * seller operation of a suspended shop stays `403`.
 */
export function requireDeliverySeller(shops: ShopAccessRepository): RequestHandler {
  return async (req, _res, next) => {
    const user = requireLoadedUser(req);
    if (!user.roles.includes("SELLER")) throw forbidden();
    const shop = await shops.findByOwnerUserId(user.id);
    if (shop === null || (shop.status !== "APPROVED" && shop.status !== "SUSPENDED")) throw forbidden();
    req.sellerShop = shop;
    next();
  };
}
