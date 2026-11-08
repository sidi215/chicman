import {
  logoUploadRequestSchema,
  SHOP_ERROR_CODES,
  shopChangeRequestCreateSchema,
  shopCreateSchema,
  shopUpdateSchema,
} from "@chicman/shared";
import { Router, type RequestHandler } from "express";

import { HttpError, serviceUnavailable } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { RateLimitError } from "../../middleware/rate-limit.js";
import { requireOwnedShop, requireShopOperation } from "../../middleware/shop-onboarding.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { LogoService } from "./logo/logo.service.js";
import type { ShopAccessRepository } from "./shop-access.repository.js";
import type { ShopService } from "./shop.service.js";

export interface ShopDependencies {
  shops: ShopService;
  shopAccess: ShopAccessRepository;
  /** `undefined` when object storage is not configured: logo routes → `503`. */
  logos: LogoService | undefined;
  rateLimiter: RateLimiter;
}

/** Logo upload requests per shop (Redis counters). */
export const LOGO_UPLOAD_RATE_LIMIT = { perShop: 10, windowMs: 10 * 60_000 } as const;

/**
 * Owner shop routes (spec 06). No route takes a shop ID: the shop is always
 * resolved from the authenticated user. Every operation not listed here is
 * denied (unmatched routes → `404`).
 */
export function createShopRouter(guards: AuthGuards, deps: ShopDependencies): Router {
  const router = Router();
  const owned = [...guards.user, requireOwnedShop(deps.shopAccess)];

  const logoService = (): LogoService => {
    if (deps.logos === undefined) throw new HttpError(503, SHOP_ERROR_CODES.logoStorageNotConfigured);
    return deps.logos;
  };

  const logoRateLimit: RequestHandler = async (req, _res, next) => {
    let result;
    try {
      result = await deps.rateLimiter.hit(
        `logo-upload:shop:${req.ownedShop?.id ?? "none"}`,
        LOGO_UPLOAD_RATE_LIMIT.perShop,
        LOGO_UPLOAD_RATE_LIMIT.windowMs,
      );
    } catch {
      throw serviceUnavailable();
    }
    if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
    next();
  };

  // Rule 1: create the shop = submit the initial application.
  router.post("/sellers/me/shop", ...guards.user, async (req, res) => {
    const user = requireLoadedUser(req);
    const input = parseOrBadRequest(shopCreateSchema, req.body);
    res.status(201).json(await deps.shops.create(user.id, input));
  });

  // Rule 5: view in any status.
  router.get("/sellers/me/shop", ...guards.user, async (req, res) => {
    const user = requireLoadedUser(req);
    res.status(200).json(await deps.shops.getOwnerView(user.id));
  });

  // Rules 3, 4, 8: update application fields.
  router.patch("/sellers/me/shop", ...owned, requireShopOperation("edit"), async (req, res) => {
    const user = requireLoadedUser(req);
    const input = parseOrBadRequest(shopUpdateSchema, req.body);
    res.status(200).json(await deps.shops.update(user, input));
  });

  // Rule 2: resubmit a rejected application.
  router.post("/sellers/me/shop/resubmit", ...owned, async (req, res) => {
    const user = requireLoadedUser(req);
    res.status(200).json(await deps.shops.resubmit(user.id));
  });

  // Rule 8: shopName/city change request.
  router.post("/sellers/me/shop/change-requests", ...owned, requireShopOperation("changeRequest"), async (req, res) => {
    const user = requireLoadedUser(req);
    const input = parseOrBadRequest(shopChangeRequestCreateSchema, req.body);
    res.status(201).json(await deps.shops.submitChangeRequest(user, input));
  });

  // Rule 9: logo upload.
  router.post("/sellers/me/shop/logo/uploads", ...owned, requireShopOperation("logo"), logoRateLimit, async (req, res) => {
    const user = requireLoadedUser(req);
    const input = parseOrBadRequest(logoUploadRequestSchema, req.body);
    const shopId = req.ownedShop?.id ?? "";
    res.status(201).json(await logoService().requestUpload({ userId: user.id, roles: user.roles, shopId }, input));
  });

  router.post(
    "/sellers/me/shop/logo/uploads/:uploadId/complete",
    ...owned,
    requireShopOperation("logo"),
    async (req, res) => {
      const user = requireLoadedUser(req);
      const shopId = req.ownedShop?.id ?? "";
      const uploadId = String(req.params["uploadId"] ?? "");
      res.status(200).json(await logoService().complete({ userId: user.id, roles: user.roles, shopId }, uploadId));
    },
  );

  return router;
}
