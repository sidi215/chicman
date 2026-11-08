import cors from "cors";
import express, { type Express, type Router } from "express";
import helmet from "helmet";

import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { createAuthGuards, createAuthRouter, type AuthDependencies } from "./modules/auth/index.js";
import type { AuthGuards } from "./modules/auth/index.js";
import { createAddressRouter, type AddressDependencies } from "./modules/addresses/index.js";
import { createAdminRouter, type AdminDependencies } from "./modules/admin/index.js";
import { createCustomerRouter, type CustomerDependencies } from "./modules/customers/index.js";
import { createProductRouter, type ProductDependencies } from "./modules/products/index.js";
import { createShopRouter, type ShopDependencies } from "./modules/shops/index.js";

export interface AppOptions {
  corsOrigins: string[];
  auth: AuthDependencies;
  /** Customer account bootstrap and profile (spec 04). */
  customers?: CustomerDependencies;
  /** Customer delivery addresses (spec 05). */
  addresses?: AddressDependencies;
  /** Owner shop routes (spec 06). */
  shops?: ShopDependencies;
  /** Administrator routes (spec 06). */
  admin?: AdminDependencies;
  /** Seller product routes (spec 07). */
  products?: ProductDependencies;
  /** Express `trust proxy` hops, so `req.ip` is the client address. */
  trustProxyHops?: number;
  /** Extra routers mounted under `/api/v1` (feature modules, test fixtures). */
  routers?: (guards: AuthGuards) => Router[];
}

export function createApp({ corsOrigins, auth, customers, addresses, shops, admin, products, trustProxyHops, routers }: AppOptions): Express {
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
  if (addresses !== undefined) app.use("/api/v1", createAddressRouter(guards, addresses));
  if (shops !== undefined) app.use("/api/v1", createShopRouter(guards, shops));
  if (admin !== undefined) app.use("/api/v1", createAdminRouter(guards, admin));
  if (products !== undefined) app.use("/api/v1", createProductRouter(guards, products));
  for (const router of routers?.(guards) ?? []) app.use("/api/v1", router);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
