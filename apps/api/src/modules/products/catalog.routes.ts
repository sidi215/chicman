import { catalogFacetsQuerySchema, catalogListQuerySchema, PRODUCT_ERROR_CODES } from "@chicman/shared";
import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { Router, type Request } from "express";

import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { CatalogService } from "./catalog.service.js";
import { idParam } from "./product.routes.js";

export interface CatalogDependencies {
  catalog: CatalogService;
  rateLimiter: RateLimiter;
  /** Shared with the web server, which calls these routes while rendering pages. */
  internalKey?: string | undefined;
}

/**
 * Per address only, as these routes have no user. Generous, because many
 * mobile customers can share one carrier address.
 */
export const CATALOG_RATE_LIMIT: RateLimitRule = { name: "catalog", perUser: 3000, perIp: 3000, windowMs: 10 * 60_000 };

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * The customer behind a request from the web server. Without this, all
 * server-rendered pages would count against the web server's address, and one
 * busy visitor could block the storefront for everyone. The header is ignored
 * without the shared key, so a client cannot choose its own limit.
 */
export function customerAddress(req: Request, internalKey: string | undefined): string | undefined {
  const key = req.get("x-chicman-internal-key");
  const address = req.get("x-chicman-client-address");
  if (internalKey === undefined || key === undefined || address === undefined) return undefined;
  if (!timingSafeEqual(digest(key), digest(internalKey))) return undefined;
  return isIP(address) === 0 ? undefined : address;
}

/**
 * Public product discovery (spec 08), with no authentication guard. A category
 * listing is `GET /products?category=…`. Every query is limited to
 * `PUBLIC_PRODUCT_WHERE` by `CatalogService`.
 */
export function createCatalogRouter(deps: CatalogDependencies): Router {
  const router = Router();
  const limit = rateLimit(deps.rateLimiter, CATALOG_RATE_LIMIT, (req) => customerAddress(req, deps.internalKey));

  router.get("/products", limit, async (req, res) => {
    res.status(200).json(await deps.catalog.list(parseOrBadRequest(catalogListQuerySchema, req.query)));
  });

  // Before `/products/:productId`, which would otherwise match it.
  router.get("/products/facets", limit, async (req, res) => {
    res.status(200).json(await deps.catalog.facets(parseOrBadRequest(catalogFacetsQuerySchema, req.query)));
  });

  router.get("/products/:productId", limit, async (req, res) => {
    res.status(200).json(await deps.catalog.get(idParam(req.params["productId"], PRODUCT_ERROR_CODES.notFound)));
  });

  return router;
}
