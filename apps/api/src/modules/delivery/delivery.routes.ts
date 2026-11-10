import { deliveryDeliveredSchema, deliveryEmptyBodySchema, deliveryFailSchema, ORDER_ERROR_CODES } from "@chicman/shared";
import { Router, type Request } from "express";

import { forbidden } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { ORDER_WRITE_RATE_LIMIT } from "../orders/order.routes.js";
import { idParam } from "../products/product.routes.js";
import type { ShopAccessRepository } from "../shops/shop-access.repository.js";
import { requireDeliverySeller } from "./delivery-guard.js";
import type { DeliveryLifecycle, DeliverySeller } from "./delivery-lifecycle.js";
import type { DeliveryQueries } from "./delivery-queries.js";

export interface DeliveryDependencies {
  lifecycle: DeliveryLifecycle;
  queries: DeliveryQueries;
  shopAccess: ShopAccessRepository;
  rateLimiter: RateLimiter;
}

const shopOrderId = (req: Request): string => idParam(req.params["shopOrderId"], ORDER_ERROR_CODES.shopOrderNotFound);

/** The seller as established by the guard, never from client input. */
function seller(req: Request): DeliverySeller {
  const user = requireLoadedUser(req);
  if (req.sellerShop === undefined) throw forbidden();
  return { userId: user.id, shopId: req.sellerShop.id };
}

/** A write route with no body accepts an empty one. */
const bodyOf = (req: Request): unknown => req.body ?? {};

/**
 * Seller delivery routes (spec 12), web only (O1). `ready` and `dispatch` need
 * an approved shop; delivered, failure, closure, and the in-progress list use
 * the narrow guard, so the owner of a suspended shop can finish deliveries
 * already under way, and nothing else. Every write validates its body first,
 * then applies a conditional transition; the response is the seller's view of
 * the delivery. Another shop's shop order is `404`.
 */
export function createDeliveryRouter(guards: AuthGuards, deps: DeliveryDependencies): Router {
  const router = Router();
  const writeLimit = rateLimit(deps.rateLimiter, ORDER_WRITE_RATE_LIMIT);
  const deliverySeller = [...guards.user, requireDeliverySeller(deps.shopAccess)];
  const base = "/sellers/me/orders/:shopOrderId/delivery";

  router.get("/sellers/me/deliveries/in-progress", ...deliverySeller, async (req, res) => {
    res.status(200).json(await deps.queries.inProgress(seller(req).shopId));
  });

  router.post(`${base}/ready`, ...guards.approvedSeller, writeLimit, async (req, res) => {
    parseOrBadRequest(deliveryEmptyBodySchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.ready(actor, id);
    res.status(200).json(await deps.queries.sellerDelivery(actor.shopId, id));
  });

  router.post(`${base}/dispatch`, ...guards.approvedSeller, writeLimit, async (req, res) => {
    parseOrBadRequest(deliveryEmptyBodySchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.dispatch(actor, id);
    res.status(200).json(await deps.queries.sellerDelivery(actor.shopId, id));
  });

  router.post(`${base}/delivered`, ...deliverySeller, writeLimit, async (req, res) => {
    const { amount } = parseOrBadRequest(deliveryDeliveredSchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.delivered(actor, id, amount);
    res.status(200).json(await deps.queries.sellerDelivery(actor.shopId, id));
  });

  router.post(`${base}/fail`, ...deliverySeller, writeLimit, async (req, res) => {
    const { reason } = parseOrBadRequest(deliveryFailSchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.fail(actor, id, reason);
    res.status(200).json(await deps.queries.sellerDelivery(actor.shopId, id));
  });

  router.post(`${base}/close`, ...deliverySeller, writeLimit, async (req, res) => {
    parseOrBadRequest(deliveryEmptyBodySchema, bodyOf(req));
    const actor = seller(req);
    const id = shopOrderId(req);
    await deps.lifecycle.close(actor, id);
    res.status(200).json(await deps.queries.sellerDelivery(actor.shopId, id));
  });

  return router;
}
