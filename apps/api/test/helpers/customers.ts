import { AuthenticationError, type EmailConfirmationChecker } from "../../src/modules/auth/index.js";

/** Email-confirmation check controlled by the test. Confirmed by default. */
export class FakeEmailConfirmation implements EmailConfirmationChecker {
  readonly unconfirmed = new Set<string>();
  readonly calls: { accessToken: string; supabaseUserId: string }[] = [];
  mode: "ok" | "unavailable" | "invalid" = "ok";

  async isEmailConfirmed(accessToken: string, supabaseUserId: string): Promise<boolean> {
    this.calls.push({ accessToken, supabaseUserId });
    if (this.mode === "unavailable") throw new AuthenticationError("unavailable");
    if (this.mode === "invalid") throw new AuthenticationError("invalid");
    return !this.unconfirmed.has(supabaseUserId);
  }
}
