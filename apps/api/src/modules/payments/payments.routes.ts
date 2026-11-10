import { ORDER_ERROR_CODES, paymentNoteSchema, sellerPaymentSummaryQuerySchema } from "@chicman/shared";
import { Router } from "express";

import { forbidden } from "../../lib/http-error.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { idParam } from "../products/product.routes.js";
import type { PaymentService } from "./payment-service.js";

export interface PaymentDependencies {
  payments: PaymentService;
}

/**
 * Payment routes (spec 13). Customers and administrators read payments
 * through spec 11's order routes; collection happens only through spec 12's
 * "delivered, cash received" action.
 */
export function createPaymentRouter(guards: AuthGuards, deps: PaymentDependencies): Router {
  const router = Router();

  // The seller's own shop, from `requireApprovedSeller`, never from the request.
  router.get("/sellers/me/payments/summary", ...guards.approvedSeller, async (req, res) => {
    if (req.sellerShop === undefined) throw forbidden();
    const query = parseOrBadRequest(sellerPaymentSummaryQuerySchema, { ...req.query });
    res.status(200).json(await deps.payments.sellerSummary(req.sellerShop.id, query));
  });

  router.post("/admin/orders/:shopOrderId/payment/notes", ...guards.role("ADMIN"), async (req, res) => {
    const admin = requireLoadedUser(req);
    // Body first: an invalid reason writes nothing.
    const { reason } = parseOrBadRequest(paymentNoteSchema, req.body ?? {});
    const shopOrderId = idParam(req.params["shopOrderId"], ORDER_ERROR_CODES.shopOrderNotFound);
    res.status(201).json(await deps.payments.addAdminNote(admin.id, shopOrderId, reason));
  });

  return router;
}
