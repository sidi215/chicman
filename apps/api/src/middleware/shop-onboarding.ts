import { SHOP_ERROR_CODES } from "@chicman/shared";
import type { RequestHandler } from "express";

import { notFound } from "../lib/http-error.js";
import type { ShopAccessRepository } from "../modules/shops/shop-access.repository.js";
import { assertShopOperationAllowed, type ShopOwnerOperation } from "../modules/shops/shop-policy.js";
import { requireLoadedUser } from "./authorize.js";

/**
 * Onboarding guards (spec 06, Authorization rules 2–5, 8, 9). The shop is
 * resolved from the authenticated user only; owner routes take no shop ID.
 * A user without a shop → `404`. Sets `req.ownedShop`.
 *
 * The status is checked again under a row lock by the service, so a
 * concurrent status change cannot slip through between the two checks.
 */
export function requireOwnedShop(shops: ShopAccessRepository): RequestHandler {
  return async (req, _res, next) => {
    const user = requireLoadedUser(req);
    const shop = await shops.findByOwnerUserId(user.id);
    if (shop === null) throw notFound(SHOP_ERROR_CODES.shopNotFound);
    req.ownedShop = shop;
    next();
  };
}

/** `403` unless the owner's shop status (and role, for `APPROVED`) allows the operation. */
export function requireShopOperation(operation: ShopOwnerOperation): RequestHandler {
  return (req, _res, next) => {
    const user = requireLoadedUser(req);
    if (req.ownedShop === undefined) throw notFound(SHOP_ERROR_CODES.shopNotFound);
    assertShopOperationAllowed(operation, req.ownedShop.status, user.roles);
    next();
  };
}
