/**
 * Token verification failure.
 *
 * - `invalid`: the credentials are invalid (→ 401). Never says which check failed.
 * - `unavailable`: the signing key could not be retrieved (→ 503, `AUTH_UNAVAILABLE`).
 */
export class AuthenticationError extends Error {
  constructor(readonly kind: "invalid" | "unavailable") {
    super(kind === "invalid" ? "Invalid credentials" : "Authentication unavailable");
    this.name = "AuthenticationError";
  }
}
