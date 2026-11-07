import { API_ERROR_CODES, AUTH_ERROR_CODES, type ApiErrorBody } from "@chicman/shared";
import type { ErrorRequestHandler, RequestHandler } from "express";

import { databaseUnavailableReason } from "../lib/database-errors.js";
import { describeError } from "../lib/describe-error.js";
import { HttpError } from "../lib/http-error.js";
import { AuthenticationError } from "../modules/auth/auth.errors.js";
import { RateLimitError } from "./rate-limit.js";

export { describeError };

const body = (code: string): ApiErrorBody => ({ error: { code } });

/** Unmatched routes. */
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(body("NOT_FOUND"));
};

/** Centralized error responses. Bodies carry only a stable code. */
export const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
  if (err instanceof AuthenticationError) {
    if (err.kind === "unavailable") {
      res.status(503).json(body(AUTH_ERROR_CODES.authUnavailable));
    } else {
      res.setHeader("WWW-Authenticate", "Bearer");
      res.status(401).json(body(AUTH_ERROR_CODES.unauthorized));
    }
    return;
  }
  if (err instanceof RateLimitError) {
    res.setHeader("Retry-After", String(err.retryAfterSeconds));
    res.status(429).json(body(err.code));
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json(body(err.code));
    return;
  }
  if (isBodyParserError(err)) {
    res.status(err.status).json(body("BAD_REQUEST"));
    return;
  }
  // A temporary database outage: the client may retry later. Logged with the
  // Prisma code and driver kind only (no message, URL, or credentials).
  const databaseUnavailable = databaseUnavailableReason(err);
  if (databaseUnavailable !== null) {
    console.warn(`Database unavailable (${databaseUnavailable})`);
    res.status(503).json(body(API_ERROR_CODES.serviceUnavailable));
    return;
  }
  // Messages can carry request data (for example a database error quoting a
  // row with a phone number), so only the type, code, and stack frames are
  // logged. Tokens and request bodies are never logged.
  console.error(describeError(err));
  res.status(500).json(body("INTERNAL_ERROR"));
};

function isBodyParserError(err: unknown): err is { status: number } {
  if (typeof err !== "object" || err === null) return false;
  const { status, type } = err as { status?: unknown; type?: unknown };
  return typeof type === "string" && typeof status === "number" && status >= 400 && status < 500;
}
