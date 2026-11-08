import { ADDRESS_ERROR_CODES, addressCreateSchema, addressUpdateSchema } from "@chicman/shared";
import { Router } from "express";

import { badRequest, notFound } from "../../lib/http-error.js";
import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import type { AddressService } from "./address.service.js";

export interface AddressDependencies {
  addresses: AddressService;
  rateLimiter: RateLimiter;
}

/** Address writes (create, update, delete, default). */
export const ADDRESS_WRITE_RATE_LIMIT: RateLimitRule = { name: "address-write", perUser: 30, perIp: 100, windowMs: 10 * 60_000 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function addressIdParam(value: unknown): string {
  const id = String(value ?? "");
  if (!UUID.test(id)) throw notFound(ADDRESS_ERROR_CODES.notFound);
  return id;
}

/**
 * `/api/v1/customers/me/addresses` (spec 05). Bootstrapped users only; every
 * route targets the authenticated user's own addresses.
 */
export function createAddressRouter(guards: AuthGuards, deps: AddressDependencies): Router {
  const router = Router();
  const write = [...guards.user, rateLimit(deps.rateLimiter, ADDRESS_WRITE_RATE_LIMIT)];

  router.get("/customers/me/addresses", ...guards.user, async (req, res) => {
    res.status(200).json(await deps.addresses.list(requireLoadedUser(req).id));
  });

  router.post("/customers/me/addresses", ...write, async (req, res) => {
    const user = requireLoadedUser(req);
    // The customer must have confirmed the pin and details.
    if ((req.body as { locationConfirmed?: unknown } | undefined)?.locationConfirmed !== true) {
      throw badRequest(ADDRESS_ERROR_CODES.locationNotConfirmed);
    }
    const input = parseOrBadRequest(addressCreateSchema, req.body);
    res.status(201).json(await deps.addresses.create(user.id, input));
  });

  router.get("/customers/me/addresses/:addressId", ...guards.user, async (req, res) => {
    res.status(200).json(await deps.addresses.get(requireLoadedUser(req).id, addressIdParam(req.params["addressId"])));
  });

  router.patch("/customers/me/addresses/:addressId", ...write, async (req, res) => {
    const user = requireLoadedUser(req);
    const addressId = addressIdParam(req.params["addressId"]);
    const input = parseOrBadRequest(addressUpdateSchema, req.body);
    res.status(200).json(await deps.addresses.update(user.id, addressId, input));
  });

  router.delete("/customers/me/addresses/:addressId", ...write, async (req, res) => {
    await deps.addresses.delete(requireLoadedUser(req).id, addressIdParam(req.params["addressId"]));
    res.status(204).end();
  });

  router.post("/customers/me/addresses/:addressId/default", ...write, async (req, res) => {
    res.status(200).json(await deps.addresses.setDefault(requireLoadedUser(req).id, addressIdParam(req.params["addressId"])));
  });

  return router;
}
