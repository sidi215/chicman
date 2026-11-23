import {
  adminModerationCaseListQuerySchema,
  adminProductListQuerySchema,
  isValidReportReason,
  MODERATION_ERROR_CODES,
  moderationDismissSchema,
  moderationResubmitSchema,
  moderationRestoreSchema,
  moderationSanctionSchema,
  PRODUCT_ERROR_CODES,
  productReportSchema,
} from "@chicman/shared";
import { Router, type Request } from "express";

import { badRequest, forbidden } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { idParam, PRODUCT_WRITE_RATE_LIMIT } from "../products/product.routes.js";
import type { AdminProductAction, AdminProductActionInput, ModerationLifecycle } from "./moderation-lifecycle.js";
import type { ModerationQueries } from "./moderation-queries.js";
import type { ProductReportService } from "./product-reports.js";

/** Server configuration values: `PRODUCT_REPORT_RATE_LIMIT_*` (spec 19, section 4). */
export interface ProductReportRateLimitConfig {
  perUser: number;
  perIp: number;
  windowMs: number;
}

export interface ModerationDependencies {
  lifecycle: ModerationLifecycle;
  queries: ModerationQueries;
  reports: ProductReportService;
  rateLimiter: RateLimiter;
  reportRateLimit: ProductReportRateLimitConfig;
}

const bodyOf = (req: Request): unknown => req.body ?? {};
const productId = (req: Request): string => idParam(req.params["productId"], PRODUCT_ERROR_CODES.notFound);
const caseId = (req: Request): string => idParam(req.params["caseId"], MODERATION_ERROR_CODES.caseNotFound);

/** The action body: an invalid or missing reason is `400` with nothing written. */
function parseAdminAction(action: AdminProductAction, body: unknown): AdminProductActionInput {
  if (action === "restore") return { action, body: parseOrBadRequest(moderationRestoreSchema, body) };
  return { action, body: parseOrBadRequest(moderationSanctionSchema, body) };
}

/**
 * Product moderation routes (spec 19, section 8.2). The actor always comes
 * from the verified token. Buyers report; the owning seller reads their
 * product's moderation and resubmits it; active administrators do the rest
 * (never on a shop they own).
 */
export function createModerationRouter(guards: AuthGuards, deps: ModerationDependencies): Router {
  const router = Router();
  const admin = guards.admin;
  const reportLimit: RateLimitRule = { name: "product-report", ...deps.reportRateLimit };

  router.post("/customers/me/product-reports", ...guards.buyer, rateLimit(deps.rateLimiter, reportLimit), async (req, res) => {
    const user = requireLoadedUser(req);
    const body = parseOrBadRequest(productReportSchema, bodyOf(req));
    if (!isValidReportReason(body)) throw badRequest(MODERATION_ERROR_CODES.reportReasonInvalid);
    const { created, receipt } = await deps.reports.report(user.id, {
      productId: body.productId,
      reasonCode: body.reasonCode,
      ...(body.details === undefined ? {} : { details: body.details }),
    });
    res.status(created ? 201 : 200).json(receipt);
  });

  // Any shop status: a suspended shop's seller still reads why a product is restricted.
  router.get("/sellers/me/products/:productId/moderation", ...guards.seller, async (req, res) => {
    const user = requireLoadedUser(req);
    res.status(200).json(await deps.queries.sellerHistory(user.id, productId(req)));
  });

  router.post(
    "/sellers/me/products/:productId/moderation/resubmit",
    ...guards.approvedSeller,
    rateLimit(deps.rateLimiter, PRODUCT_WRITE_RATE_LIMIT),
    async (req, res) => {
      const user = requireLoadedUser(req);
      if (req.sellerShop === undefined) throw forbidden();
      const id = productId(req);
      const body = parseOrBadRequest(moderationResubmitSchema, bodyOf(req));
      res.status(200).json(await deps.lifecycle.resubmit({ userId: user.id, shopId: req.sellerShop.id }, id, body));
    },
  );

  router.get("/admin/products", ...admin, async (req, res) => {
    const query = parseOrBadRequest(adminProductListQuerySchema, { ...req.query });
    res.status(200).json(await deps.queries.adminProducts(query));
  });

  router.get("/admin/products/:productId", ...admin, async (req, res) => {
    const adminUser = requireLoadedUser(req);
    res.status(200).json(await deps.queries.adminProduct(productId(req), adminUser.id));
  });

  for (const action of ["restrict", "request-correction", "restore", "remove"] as const) {
    router.post(`/admin/products/:productId/moderation/${action}`, ...admin, async (req, res) => {
      const adminUser = requireLoadedUser(req);
      const id = productId(req);
      const input = parseAdminAction(action, bodyOf(req));
      res.status(200).json(await deps.lifecycle.adminAct(adminUser.id, id, input));
    });
  }

  router.get("/admin/moderation/cases", ...admin, async (req, res) => {
    const query = parseOrBadRequest(adminModerationCaseListQuerySchema, { ...req.query });
    res.status(200).json(await deps.queries.cases(query));
  });

  router.get("/admin/moderation/cases/:caseId", ...admin, async (req, res) => {
    const adminUser = requireLoadedUser(req);
    res.status(200).json(await deps.queries.caseDetail(caseId(req), adminUser.id));
  });

  router.post("/admin/moderation/cases/:caseId/dismiss", ...admin, async (req, res) => {
    const adminUser = requireLoadedUser(req);
    const id = caseId(req);
    const body = parseOrBadRequest(moderationDismissSchema, bodyOf(req));
    res.status(200).json(await deps.lifecycle.dismiss(adminUser.id, id, body));
  });

  return router;
}
