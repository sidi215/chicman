import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";

import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createAuthGuards, createAuthRouter, type AuthDependencies } from "./modules/auth/index.js";
import type { AuthGuards } from "./modules/auth/index.js";
import { createCustomerRouter, type CustomerDependencies } from "./modules/customers/index.js";

export interface AppOptions {
  corsOrigins: string[];
  auth: AuthDependencies;
  /** Customer account bootstrap and profile (spec 04). */
  customers?: CustomerDependencies;
  /** Express `trust proxy` hops, so `req.ip` is the client address. */
  trustProxyHops?: number;
  /** Extra routers mounted under `/api/v1` (feature modules, test fixtures). */
  routers?: (guards: AuthGuards) => Router[];
}

export function createApp({ corsOrigins, auth, customers, trustProxyHops, routers }: AppOptions): Express {
  const app = express();
  const guards = createAuthGuards(auth);

  app.disable("x-powered-by");
  app.set("trust proxy", trustProxyHops ?? 0);
  app.use(helmet());
  app.use(cors({ origin: corsOrigins }));
  app.use(express.json({ limit: "100kb" }));

  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  app.use("/api/v1/auth", createAuthRouter(guards));
  if (customers !== undefined) app.use("/api/v1", createCustomerRouter(guards, customers));
  for (const router of routers?.(guards) ?? []) app.use("/api/v1", router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
