import type { SupabaseClient } from "@supabase/supabase-js"

import { authErrorKey, isEnumerationSensitive } from "./auth-errors"
import type { EmailLink } from "./callback"
import type { AuthErrorKey } from "./messages"

export type AuthActionResult = { ok: true } | { ok: false; error: AuthErrorKey }

const fail = (error: unknown): AuthActionResult => ({ ok: false, error: authErrorKey(error) })

/** Only adds `captchaToken` when one was obtained (Turnstile not configured → none). */
const captcha = (captchaToken: string | undefined) => (captchaToken ? { captchaToken } : {})

/**
 * Supabase Auth operations (spec 03): email + password, mandatory email
 * confirmation, email recovery. `callbackUrl` is `<SITE_URL>/auth/callback`.
 */
export function createAuthService(supabase: SupabaseClient, callbackUrl: () => string) {
  return {
    /** Sends the confirmation email. Never reveals whether the email is registered. */
    async register(email: string, password: string, captchaToken?: string): Promise<AuthActionResult> {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: callbackUrl(), ...captcha(captchaToken) },
      })
      if (error && !isEnumerationSensitive(error)) return fail(error)
      return { ok: true }
    },

    async resendConfirmation(email: string, captchaToken?: string): Promise<AuthActionResult> {
      const { error } = await supabase.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: callbackUrl(), ...captcha(captchaToken) },
      })
      if (error && !isEnumerationSensitive(error)) return fail(error)
      return { ok: true }
    },

    async signIn(email: string, password: string, captchaToken?: string): Promise<AuthActionResult> {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
        options: captcha(captchaToken),
      })
      return error ? fail(error) : { ok: true }
    },

    /** Always reports success for unknown addresses (no account enumeration). */
    async requestPasswordReset(email: string, captchaToken?: string): Promise<AuthActionResult> {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: callbackUrl(),
        ...captcha(captchaToken),
      })
      if (!error) return { ok: true }
      const key = authErrorKey(error)
      return key === "rateLimited" || key === "captchaFailed" || key === "network" || key === "invalidEmail"
        ? { ok: false, error: key }
        : { ok: true }
    },

    /**
     * Completes a confirmation or recovery link and creates the session:
     * - token hash (custom templates): verified with `verifyOtp`;
     * - session tokens (Supabase default templates, already verified by
     *   Supabase's endpoint): `setSession`, which checks the access token
     *   with Supabase (or refreshes it) before storing anything.
     */
    async verifyEmailLink(link: EmailLink): Promise<AuthActionResult> {
      const { data, error } =
        link.kind === "token-hash"
          ? await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type })
          : await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
      if (error) return fail(error)
      return data.session ? { ok: true } : { ok: false, error: "generic" }
    },

    async updatePassword(password: string): Promise<AuthActionResult> {
      const { error } = await supabase.auth.updateUser({ password })
      return error ? fail(error) : { ok: true }
    },

    /** Ends the session on this device. Local tokens are cleared even if the network call fails. */
    async signOut(): Promise<void> {
      const { error } = await supabase.auth.signOut({ scope: "local" })
      if (error) console.warn("Sign-out request failed; local session cleared.")
    },
  }
}

export type AuthService = ReturnType<typeof createAuthService>
