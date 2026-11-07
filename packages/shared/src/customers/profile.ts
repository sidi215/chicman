import type { Role } from "../auth/roles.js";

/** Interface languages (`CustomerProfile.preferredLocale`). */
export const LOCALES = ["fr", "ar"] as const;
export type Locale = (typeof LOCALES)[number];

/** Bounds of `fullName` (spec 04). */
export const FULL_NAME_MAX_LENGTH = 100;

/**
 * The customer's own profile. `phone` is unverified contact information in
 * E.164; it is not an authentication identity and has no verification state.
 */
export interface CustomerProfile {
  id: string;
  fullName: string | null;
  preferredLocale: Locale;
  phone: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /api/v1/customers/me` (account setup) request body. */
export interface CustomerBootstrapRequest {
  phone: string;
}

/** `PATCH /api/v1/customers/me` request body. At least one field. */
export interface CustomerProfileUpdateRequest {
  fullName?: string;
  preferredLocale?: Locale;
  phone?: string;
}

/** Response of `GET`, `POST`, and `PATCH /api/v1/customers/me`. */
export interface CustomerProfileResponse {
  userId: string;
  roles: Role[];
  profile: CustomerProfile;
}
