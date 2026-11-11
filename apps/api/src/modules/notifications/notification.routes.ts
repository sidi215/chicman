import { NOTIFICATION_ERROR_CODES, notificationListQuerySchema, notificationScopeQuerySchema } from "@chicman/shared";
import { Router, type Request } from "express";

import type { RateLimiter } from "../../lib/rate-limiter.js";
import { parseOrBadRequest } from "../../lib/validation.js";
import { requireLoadedUser } from "../../middleware/authorize.js";
import { rateLimit, type RateLimitRule } from "../../middleware/rate-limit.js";
import type { AuthGuards } from "../auth/auth.guards.js";
import { idParam } from "../products/product.routes.js";
import type { NotificationService } from "./notification.service.js";

export interface NotificationDependencies {
  notifications: NotificationService;
  rateLimiter: RateLimiter;
}

/** Marking read. Generous, because opening each notification is one request. */
export const NOTIFICATION_WRITE_RATE_LIMIT: RateLimitRule = { name: "notification-write", perUser: 300, perIp: 600, windowMs: 10 * 60_000 };

const notificationId = (req: Request): string => idParam(req.params["notificationId"], NOTIFICATION_ERROR_CODES.notFound);

/**
 * `/api/v1/customers/me/notifications` (spec 15). Every bootstrapped user,
 * seller or administrator included, is a customer (spec 04), so one prefix
 * serves them all. The recipient is always the authenticated user; another
 * user's notification is a `404`. Both writes are idempotent and answer `204`.
 */
export function createNotificationRouter(guards: AuthGuards, deps: NotificationDependencies): Router {
  const router = Router();
  const write = [...guards.user, rateLimit(deps.rateLimiter, NOTIFICATION_WRITE_RATE_LIMIT)];
  const base = "/customers/me/notifications";

  router.get(base, ...guards.user, async (req, res) => {
    const query = parseOrBadRequest(notificationListQuerySchema, { ...req.query });
    res.status(200).json(await deps.notifications.list(requireLoadedUser(req).id, query));
  });

  router.get(`${base}/unread-count`, ...guards.user, async (req, res) => {
    const query = parseOrBadRequest(notificationScopeQuerySchema, { ...req.query });
    res.status(200).json(await deps.notifications.unreadCount(requireLoadedUser(req).id, query));
  });

  // Before `/:notificationId/read`, so "read-all" is never taken for an ID.
  router.post(`${base}/read-all`, ...write, async (req, res) => {
    const query = parseOrBadRequest(notificationScopeQuerySchema, { ...req.query });
    await deps.notifications.markAllRead(requireLoadedUser(req).id, query);
    res.status(204).end();
  });

  router.post(`${base}/:notificationId/read`, ...write, async (req, res) => {
    await deps.notifications.markRead(requireLoadedUser(req).id, notificationId(req));
    res.status(204).end();
  });

  return router;
}
