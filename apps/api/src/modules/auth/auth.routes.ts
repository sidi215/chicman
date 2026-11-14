import type { AccountSessionResponse } from "@chicman/shared";
import { Router } from "express";

import { requireLoadedUser } from "../../middleware/authorize.js";
import type { AuthGuards } from "./auth.guards.js";

/** `/api/v1/auth` */
export function createAuthRouter(guards: AuthGuards): Router {
  const router = Router();

  // Session check for clients: the verified identity's account and its type
  // (AT-1), as loaded from PostgreSQL. 401 invalid token, 503 key material
  // unavailable (keep the session), 403 before account setup.
  router.get("/session", ...guards.user, (req, res) => {
    const user = requireLoadedUser(req);
    const response: AccountSessionResponse = { userId: user.id, accountType: user.accountType };
    res.status(200).json(response);
  });

  return router;
}
