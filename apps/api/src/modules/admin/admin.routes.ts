import {
  applicationRejectionSchema,
  internalDecisionSchema,
  SHOP_ERROR_CODES,
  SHOP_STATUSES,
} from "@chicman/shared";
import { Router } from "express";
import { z } from "zod";

import { notFound } from "../../lib/http-error.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { ShopDecisionAction, ShopDecisionInput, ShopLifecycle } from "../shops/shop-lifecycle.js";
import type { AdminShopQueries } from "./admin-shops.repository.js";

export interface AdminDependencies {
  lifecycle: ShopLifecycle;
  queries: AdminShopQueries;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const listQuerySchema = z.strictObject({
  status: z.enum(SHOP_STATUSES).optional(),
  openChangeRequest: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

function shopIdParam(value: unknown): string {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw notFound(SHOP_ERROR_CODES.shopNotFound);
  return id;
}

/** The decision body for an action: exactly one reason, of the right kind. */
function parseDecision(action: ShopDecisionAction, body: unknown): ShopDecisionInput {
  if (action === "reject") return { action, body: parseOrBadRequest(applicationRejectionSchema, body) };
  return { action, body: parseOrBadRequest(internalDecisionSchema, body) };
}

/**
 * `/api/v1/admin` shop administration (spec 06, rule 7). Administrators
 * only (role `ADMIN` from PostgreSQL): others → `403`, no token → `401`.
 */
export function createAdminRouter(guards: AuthGuards, deps: AdminDependencies): Router {
  const router = Router();
  const admin = guards.role("ADMIN");

  router.get("/admin/shops", ...admin, async (req, res) => {
    const query = parseOrBadRequest(listQuerySchema, req.query);
    res.status(200).json(
      await deps.queries.list({
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.openChangeRequest === undefined ? {} : { openChangeRequest: query.openChangeRequest === "true" }),
        limit: query.limit ?? 50,
      }),
    );
  });

  router.get("/admin/shops/:shopId", ...admin, async (req, res) => {
    const adminUser = requireLoadedUser(req);
    const detail = await deps.queries.detail(shopIdParam(req.params["shopId"]), adminUser.id);
    if (detail === null) throw notFound(SHOP_ERROR_CODES.shopNotFound);
    res.status(200).json(detail);
  });

  for (const action of ["approve", "reject", "suspend", "reinstate"] as const) {
    router.post(`/admin/shops/:shopId/${action}`, ...admin, async (req, res) => {
      const adminUser = requireLoadedUser(req);
      const shopId = shopIdParam(req.params["shopId"]);
      // Body first: an invalid reason changes nothing.
      const decision = parseDecision(action, req.body);
      res.status(200).json(await deps.lifecycle.decide(shopId, adminUser.id, decision));
    });
  }

  for (const [action, outcome] of [
    ["approve", "APPROVED"],
    ["reject", "REJECTED"],
  ] as const) {
    router.post(`/admin/shops/:shopId/change-requests/:requestId/${action}`, ...admin, async (req, res) => {
      const adminUser = requireLoadedUser(req);
      const shopId = shopIdParam(req.params["shopId"]);
      const requestId = String(req.params["requestId"] ?? "");
      if (!UUID.test(requestId)) throw notFound(SHOP_ERROR_CODES.changeRequestNotFound);
      const body = parseOrBadRequest(internalDecisionSchema, req.body);
      res.status(200).json(await deps.lifecycle.decideChangeRequest(shopId, requestId, adminUser.id, outcome, body));
    });
  }

  return router;
}
