import {
  PRODUCT_ERROR_CODES,
  productCreateSchema,
  productImageOrderSchema,
  productImageUploadRequestSchema,
  productListQuerySchema,
  productUpdateSchema,
  stockUpdateSchema,
  variantCreateSchema,
  variantUpdateSchema,
} from "@chicman/shared";
import { Router, type Request } from "express";

import { forbidden, HttpError, notFound } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { StockService } from "../inventory/stock.service.js";
import type { ProductImageService } from "./images/product-image.service.js";
import type { ProductSeller } from "./product-lock.js";
import type { ProductService } from "./product.service.js";

export interface ProductDependencies {
  products: ProductService;
  stock: StockService;
  /** `undefined` when object storage is not configured: upload routes → `503`. */
  images: ProductImageService | undefined;
  rateLimiter: RateLimiter;
}

/** Product writes (create, update, stock, variants, images, publish, archive). */
export const PRODUCT_WRITE_RATE_LIMIT: RateLimitRule = { name: "product-write", perUser: 300, perIp: 600, windowMs: 10 * 60_000 };
/** Image upload requests: enough for several products with all their images. */
export const PRODUCT_IMAGE_UPLOAD_RATE_LIMIT: RateLimitRule = { name: "product-image-upload", perUser: 60, perIp: 120, windowMs: 10 * 60_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A malformed ID cannot exist, so it gets the resource's `404`. */
export function idParam(value: unknown, code: string): string {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw notFound(code);
  return id;
}

const productId = (req: Request): string => idParam(req.params["productId"], PRODUCT_ERROR_CODES.notFound);
const variantId = (req: Request): string => idParam(req.params["variantId"], PRODUCT_ERROR_CODES.variantNotFound);
const imageId = (req: Request): string => idParam(req.params["imageId"], PRODUCT_ERROR_CODES.imageNotFound);

/** The approved seller as established by `requireApprovedSeller`, never from client input. */
function seller(req: Request): ProductSeller {
  const user = requireLoadedUser(req);
  if (req.sellerShop === undefined) throw forbidden();
  return { userId: user.id, shopId: req.sellerShop.id };
}

/**
 * `/api/v1/sellers/me/products` (spec 07). Every route requires an approved
 * seller. No route takes a shop or owner ID: the shop comes from the
 * authenticated user, and another shop's product resolves to `404`. There is
 * no delete route (archiving keeps history). Public routes: `catalog.routes.ts`.
 */
export function createProductRouter(guards: AuthGuards, deps: ProductDependencies): Router {
  const router = Router();
  const read = guards.approvedSeller;
  const write = [...guards.approvedSeller, rateLimit(deps.rateLimiter, PRODUCT_WRITE_RATE_LIMIT)];
  const uploadRequest = [...guards.approvedSeller, rateLimit(deps.rateLimiter, PRODUCT_IMAGE_UPLOAD_RATE_LIMIT)];

  const images = (): ProductImageService => {
    if (deps.images === undefined) throw new HttpError(503, PRODUCT_ERROR_CODES.imageStorageNotConfigured);
    return deps.images;
  };

  router.get("/sellers/me/products", ...read, async (req, res) => {
    const query = parseOrBadRequest(productListQuerySchema, req.query);
    res.status(200).json(await deps.products.list(seller(req), query));
  });

  router.post("/sellers/me/products", ...write, async (req, res) => {
    const input = parseOrBadRequest(productCreateSchema, req.body);
    res.status(201).json(await deps.products.create(seller(req), input));
  });

  router.get("/sellers/me/products/:productId", ...read, async (req, res) => {
    res.status(200).json(await deps.products.get(seller(req), productId(req)));
  });

  router.patch("/sellers/me/products/:productId", ...write, async (req, res) => {
    const id = productId(req);
    const input = parseOrBadRequest(productUpdateSchema, req.body);
    res.status(200).json(await deps.products.update(seller(req), id, input));
  });

  router.post("/sellers/me/products/:productId/publish", ...write, async (req, res) => {
    res.status(200).json(await deps.products.publish(seller(req), productId(req)));
  });

  router.post("/sellers/me/products/:productId/archive", ...write, async (req, res) => {
    res.status(200).json(await deps.products.archive(seller(req), productId(req)));
  });

  router.post("/sellers/me/products/:productId/restore", ...write, async (req, res) => {
    res.status(200).json(await deps.products.restore(seller(req), productId(req)));
  });

  router.put("/sellers/me/products/:productId/stock", ...write, async (req, res) => {
    const id = productId(req);
    const input = parseOrBadRequest(stockUpdateSchema, req.body);
    res.status(200).json(await deps.stock.setProductStock(seller(req), id, input));
  });

  router.post("/sellers/me/products/:productId/variants", ...write, async (req, res) => {
    const id = productId(req);
    const input = parseOrBadRequest(variantCreateSchema, req.body);
    res.status(201).json(await deps.products.addVariant(seller(req), id, input));
  });

  router.patch("/sellers/me/products/:productId/variants/:variantId", ...write, async (req, res) => {
    const [id, variant] = [productId(req), variantId(req)];
    const input = parseOrBadRequest(variantUpdateSchema, req.body);
    res.status(200).json(await deps.products.updateVariant(seller(req), id, variant, input));
  });

  router.delete("/sellers/me/products/:productId/variants/:variantId", ...write, async (req, res) => {
    res.status(200).json(await deps.products.removeVariant(seller(req), productId(req), variantId(req)));
  });

  router.put("/sellers/me/products/:productId/variants/:variantId/stock", ...write, async (req, res) => {
    const [id, variant] = [productId(req), variantId(req)];
    const input = parseOrBadRequest(stockUpdateSchema, req.body);
    res.status(200).json(await deps.stock.setVariantStock(seller(req), id, variant, input));
  });

  router.post("/sellers/me/products/:productId/images/uploads", ...uploadRequest, async (req, res) => {
    const id = productId(req);
    const input = parseOrBadRequest(productImageUploadRequestSchema, req.body);
    res.status(201).json(await images().requestUpload(seller(req), id, input));
  });

  router.post("/sellers/me/products/:productId/images/uploads/:uploadId/complete", ...write, async (req, res) => {
    const uploadId = String(req.params["uploadId"] ?? "");
    res.status(200).json(await images().complete(seller(req), productId(req), uploadId));
  });

  router.put("/sellers/me/products/:productId/images/order", ...write, async (req, res) => {
    const id = productId(req);
    const input = parseOrBadRequest(productImageOrderSchema, req.body);
    res.status(200).json(await deps.products.reorderImages(seller(req), id, input));
  });

  router.delete("/sellers/me/products/:productId/images/:imageId", ...write, async (req, res) => {
    res.status(200).json(await deps.products.removeImage(seller(req), productId(req), imageId(req)));
  });

  return router;
}
