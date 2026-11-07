import type { RequestHandler } from "express";

import { AuthenticationError } from "../modules/auth/auth.errors.js";
import type { TokenVerifier } from "../modules/auth/token-verifier.js";

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Extracts exactly one Bearer token from the `Authorization` header.
 * Tokens in query strings, cookies, or the body are never read.
 */
export function extractBearerToken(rawHeaders: readonly string[]): string {
  const values: string[] = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === "authorization") values.push(rawHeaders[i + 1] ?? "");
  }
  // Node keeps only the first duplicate `Authorization` header, so duplicates
  // are counted from the raw headers.
  if (values.length !== 1) throw new AuthenticationError("invalid");
  const match = BEARER.exec(values[0] ?? "");
  if (match?.[1] === undefined) throw new AuthenticationError("invalid");
  return match[1];
}

/** Step 1: verify the access token and set `req.auth`. */
export function authenticate(verifier: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const token = extractBearerToken(req.rawHeaders);
    req.auth = await verifier.verify(token);
    // Kept only for server-to-server calls made on the user's behalf (the
    // email-confirmation check). Never logged or returned.
    req.accessToken = token;
    next();
  };
}
