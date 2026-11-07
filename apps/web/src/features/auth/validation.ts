import { normalizePhoneNumber } from "@chicman/shared"

import type { AuthErrorKey } from "./messages"

export type FieldErrors<F extends string> = Partial<Record<F, AuthErrorKey>>

export type Validated<T, F extends string> = { ok: true; value: T } | { ok: false; errors: FieldErrors<F> }

// Deliberately simple: Supabase Auth makes the final decision.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_MAX_LENGTH = 254

/** Trimmed, lower-cased email, or `null` when it is not plausibly valid. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase()
  return email.length <= EMAIL_MAX_LENGTH && EMAIL.test(email) ? email : null
}

export function validateEmail(input: string): Validated<string, "email"> {
  const email = normalizeEmail(input)
  return email ? { ok: true, value: email } : { ok: false, errors: { email: "invalidEmail" } }
}

export function validateLogin(input: { email: string; password: string }): Validated<
  { email: string; password: string },
  "email" | "password"
> {
  const email = normalizeEmail(input.email)
  const errors: FieldErrors<"email" | "password"> = {}
  if (!email) errors.email = "invalidEmail"
  if (input.password.length === 0) errors.password = "passwordRequired"
  return email && !errors.password ? { ok: true, value: { email, password: input.password } } : { ok: false, errors }
}

/**
 * Sign-up: email and password only (the phone is collected at account setup).
 * Password strength is enforced by the Supabase project's password policy.
 */
export function validateRegistration(input: { email: string; password: string; confirmPassword: string }): Validated<
  { email: string; password: string },
  "email" | "password" | "confirmPassword"
> {
  const email = normalizeEmail(input.email)
  const errors: FieldErrors<"email" | "password" | "confirmPassword"> = {}
  if (!email) errors.email = "invalidEmail"
  const password = validateNewPassword(input)
  if (!password.ok) Object.assign(errors, password.errors)
  return email && password.ok ? { ok: true, value: { email, password: password.value } } : { ok: false, errors }
}

export function validateNewPassword(input: { password: string; confirmPassword: string }): Validated<
  string,
  "password" | "confirmPassword"
> {
  if (input.password.length === 0) return { ok: false, errors: { password: "passwordRequired" } }
  if (input.password !== input.confirmPassword) return { ok: false, errors: { confirmPassword: "passwordMismatch" } }
  return { ok: true, value: input.password }
}

/** Account setup: the contact phone, normalized to E.164 (the API validates again). */
export function validatePhone(input: string): Validated<string, "phone"> {
  const phone = normalizePhoneNumber(input)
  return phone ? { ok: true, value: phone } : { ok: false, errors: { phone: "invalidPhone" } }
}
