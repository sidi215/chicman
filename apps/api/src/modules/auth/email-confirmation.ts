import { AuthenticationError } from "./auth.errors.js";

/**
 * Checks, on the server, whether a Supabase identity's email is confirmed.
 * Client input and user-writable token claims (`user_metadata`) are never
 * used for this decision (spec 04, Bootstrap).
 */
export interface EmailConfirmationChecker {
  /**
   * Returns `true` when the email of the identity `supabaseUserId` is
   * confirmed. Throws `AuthenticationError("invalid")` (→ 401) when Supabase
   * rejects the token, and `AuthenticationError("unavailable")` (→ 503) when
   * Supabase Auth cannot be reached.
   */
  isEmailConfirmed(accessToken: string, supabaseUserId: string): Promise<boolean>;
}

export interface SupabaseEmailConfirmationOptions {
  supabaseUrl: string;
  publishableKey: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

/**
 * Reads the user's own Auth record (`GET /auth/v1/user`) with their access
 * token and the publishable key. No secret key is needed: Supabase returns
 * only the record of the token's owner.
 */
export class SupabaseEmailConfirmationChecker implements EmailConfirmationChecker {
  private readonly endpoint: URL;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SupabaseEmailConfirmationOptions) {
    this.endpoint = new URL("/auth/v1/user", options.supabaseUrl);
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async isEmailConfirmed(accessToken: string, supabaseUserId: string): Promise<boolean> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "GET",
        headers: {
          accept: "application/json",
          apikey: this.options.publishableKey,
          authorization: `Bearer ${accessToken}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      // Logged without the token or headers: only the failure kind.
      reportFailure(error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error");
      throw new AuthenticationError("unavailable");
    }

    // The session behind the token was revoked or the token is not accepted.
    if (response.status === 401 || response.status === 403) {
      throw new AuthenticationError("invalid");
    }
    if (!response.ok) {
      reportFailure(`HTTP ${response.status}`);
      throw new AuthenticationError("unavailable");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      reportFailure("invalid JSON");
      throw new AuthenticationError("unavailable");
    }
    if (typeof body !== "object" || body === null) {
      reportFailure("unexpected response");
      throw new AuthenticationError("unavailable");
    }
    const { id, email_confirmed_at: confirmedAt } = body as { id?: unknown; email_confirmed_at?: unknown };

    // The record must belong to the verified `sub`.
    if (typeof id !== "string" || id.toLowerCase() !== supabaseUserId) {
      throw new AuthenticationError("invalid");
    }
    return typeof confirmedAt === "string" && confirmedAt.length > 0;
  }
}

/** Supabase Auth could not confirm the email (→ 503). Never logs tokens. */
function reportFailure(reason: string): void {
  console.warn(`Email-confirmation check unavailable: ${reason}`);
}
