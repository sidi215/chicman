import type { AuthSessionResponse } from "@chicman/shared";
import { Router } from "express";

import { requireLoadedUser } from "../../middleware/authorize.js";
import type { AuthGuards } from "./auth.guards.js";

/** `/api/v1/auth` */
export function createAuthRouter(guards: AuthGuards): Router {
  const router = Router();

  // Session check for clients: the verified identity's application user and
  // roles, as loaded from PostgreSQL. 401 invalid token, 503 key material
  // unavailable (keep the session), 403 before bootstrap.
  router.get("/session", ...guards.user, (req, res) => {
    const user = requireLoadedUser(req);
    const response: AuthSessionResponse = { userId: user.id, roles: user.roles };
    res.status(200).json(response);
  });

  return router;
}
