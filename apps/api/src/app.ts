import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.corsOrigins }));
  app.use(express.json());

  app.get("/api/v1/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  return app;
}
