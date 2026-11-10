import {
  adminOrderCancellationSchema,
  adminOrderListQuerySchema,
  customerCancellationSchema,
  customerOrderListQuerySchema,
  ORDER_ERROR_CODES,
  sellerCancellationSchema,
  sellerConfirmationSchema,
  sellerOrderListQuerySchema,
  sellerRejectionSchema,
} from "@chicman/shared";
import { Router, type Request } from "express";

import { forbidden } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { idParam } from "../products/product.routes.js";
import type { OrderQueries } from "./order-queries.js";
import type { ShopOrderLifecycle } from "./shop-order-lifecycle.js";

export interface OrderDependencies {
  lifecycle: ShopOrderLifecycle;
  queries: OrderQueries;
  rateLimiter: RateLimiter;
}

/** Seller and customer order writes reuse the product write limits (spec 11): 300 per user, 600 per IP, 10 minutes. */
export const ORDER_WRITE_RATE_LIMIT: RateLimitRule = { name: "order-write", perUser: 300, perIp: 600, windowMs: 10 * 60_000 };

const orderId = (req: Request): string => idParam(req.params["orderId"], ORDER_ERROR_CODES.notFound);
const shopOrderId = (req: Request): string => idParam(req.params["shopOrderId"], ORDER_ERROR_CODES.shopOrderNotFound);

/** The approved seller as established by `requireApprovedSeller`, never from client input. */
function seller(req: Request): { userId: string; shopId: string } {
  const user = requireLoadedUser(req);
  if (req.sellerShop === undefined) throw forbidden();
  return { userId: user.id, shopId: req.sellerShop.id };
}

/** A write route with no body accepts an empty one. */
const bodyOf = (req: Request): unknown => req.body ?? {};

/**
 * Order routes (spec 11). Identity always comes from the token: customers see
 * their own orders, sellers their own shop's shop orders (`req.sellerShop`),
 * and another's resolve to `404`. Every write validates its body first, then
 * applies a conditional transition; the response is the caller's own view.
 */
export function createOrderRouter(guards: AuthGuards, deps: OrderDependencies): Router {
  const router = Router();
  const writeLimit = rateLimit(deps.rateLimiter, ORDER_WRITE_RATE_LIMIT);
  const admin = guards.role("ADMIN");

  // Customer
  router.get("/customers/me/orders", ...guards.user, async (req, res) => {
    const user = requireLoadedUser(req);
    const query = parseOrBadRequest(customerOrderListQuerySchema, { ...req.query });
    res.status(200).json(await deps.queries.customerList(user.id, query));
  });

  router.get("/customers/me/orders/:orderId", ...guards.user, async (req, res) => {
    const user = requireLoadedUser(req);
    res.status(200).json(await deps.queries.customerOrder(user.id, orderId(req)));
  });

  router.post("/customers/me/orders/:orderId/shop-orders/:shopOrderId/cancel", ...guards.user, writeLimit, async (req, res) => {
    const user = requireLoadedUser(req);
    const input = parseOrBadRequest(customerCancellationSchema, bodyOf(req));
    const order = orderId(req);
    await deps.lifecycle.cancelByCustomer({ userId: user.id, orderId: order }, shopOrderId(req), input);
    res.status(200).json(await deps.queries.customerOrder(user.id, order));
  });

  // Seller (approved shop only; suspended owners get 403 for all of these)
  router.get("/sellers/me/orders", ...guards.approvedSeller, async (req, res) => {
    const query = parseOrBadRequest(sellerOrderListQuerySchema, { ...req.query });
    res.status(200).json(await deps.queries.sellerList(seller(req).shopId, query));
  });

  router.get("/sellers/me/orders/:shopOrderId", ...guards.approvedSeller, async (req, res) => {
    res.status(200).json(await deps.queries.sellerShopOrder(seller(req).shopId, shopOrderId(req)));
  });

  router.post("/sellers/me/orders/:shopOrderId/confirm", ...guards.approvedSeller, writeLimit, async (req, res) => {
    parseOrBadRequest(sellerConfirmationSchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.confirm(actor, id);
    res.status(200).json(await deps.queries.sellerShopOrder(actor.shopId, id));
  });

  router.post("/sellers/me/orders/:shopOrderId/reject", ...guards.approvedSeller, writeLimit, async (req, res) => {
    const { reason } = parseOrBadRequest(sellerRejectionSchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.reject(actor, id, reason);
    res.status(200).json(await deps.queries.sellerShopOrder(actor.shopId, id));
  });

  router.post("/sellers/me/orders/:shopOrderId/cancel", ...guards.approvedSeller, writeLimit, async (req, res) => {
    const { reason } = parseOrBadRequest(sellerCancellationSchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.cancelBySeller(actor, id, reason);
    res.status(200).json(await deps.queries.sellerShopOrder(actor.shopId, id));
  });

  // Administrator
  router.get("/admin/orders", ...admin, async (req, res) => {
    const query = parseOrBadRequest(adminOrderListQuerySchema, { ...req.query });
    res.status(200).json(await deps.queries.adminList(query));
  });

  router.get("/admin/orders/:shopOrderId", ...admin, async (req, res) => {
    const adminUser = requireLoadedUser(req);
    res.status(200).json(await deps.queries.adminShopOrder(shopOrderId(req), adminUser.id));
  });

  router.post("/admin/orders/:shopOrderId/cancel", ...admin, async (req, res) => {
    const adminUser = requireLoadedUser(req);
    // Body first: an invalid reason changes nothing.
    const input = parseOrBadRequest(adminOrderCancellationSchema, bodyOf(req));
    const id = shopOrderId(req);
    await deps.lifecycle.cancelByAdmin(adminUser.id, id, input);
    res.status(200).json(await deps.queries.adminShopOrder(id, adminUser.id));
  });

  return router;
}
