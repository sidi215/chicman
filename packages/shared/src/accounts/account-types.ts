import { z } from "zod";

import type { Locale } from "../customers/profile.js";
import { shopCreateSchema } from "../shops/schemas.js";

/**
 * Account types (AT-1, `context/account-types-audit.md`). Every account has
 * exactly one type, fixed when it is created and never changed. The API reads
 * it from PostgreSQL on every request; it never comes from token claims,
 * `user_metadata`, or a request body.
 */
export const ACCOUNT_TYPES = ["BUYER", "SELLER", "ADMIN"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** The types a person can choose at public registration. `ADMIN` is provisioned by an operator only. */
export const REGISTRABLE_ACCOUNT_TYPES = ["BUYER", "SELLER"] as const satisfies readonly AccountType[];
export type RegistrableAccountType = (typeof REGISTRABLE_ACCOUNT_TYPES)[number];

/** Unconsumed registration intents are deleted after this many days (AT-1, section 5.3). */
export const REGISTRATION_INTENT_TTL_DAYS = 30;

/**
 * `POST /api/v1/registration-intents`, sent right after a Supabase sign-up,
 * before any session exists. Write-once per identity: the first value is kept.
 * The answer does not reveal whether the identity exists.
 */
export const registrationIntentSchema = z.strictObject({
  supabaseUserId: z.uuid(),
  accountType: z.enum(REGISTRABLE_ACCOUNT_TYPES),
});
export type RegistrationIntentInput = z.output<typeof registrationIntentSchema>;

/**
 * `GET /api/v1/registration-intents/me` (verified token, before or after
 * setup): the identity's own intent, so the setup screen shows the right form.
 * `null` when none was recorded (the screen then asks).
 */
export interface RegistrationIntentResponse {
  accountType: RegistrableAccountType | null;
}

/** The personal phone as typed; the API normalizes it to E.164 (`INVALID_PHONE` otherwise). */
const rawPhone = z.string().max(32);

/**
 * `POST /api/v1/accounts/me/setup` for a `BUYER` intent: the personal phone
 * (required for buyers). The body never carries the account type: the API
 * reads the identity's registration intent.
 */
export const buyerAccountSetupSchema = z.strictObject({ phone: rawPhone });
export type BuyerAccountSetupInput = z.output<typeof buyerAccountSetupSchema>;

/**
 * `POST /api/v1/accounts/me/setup` for a `SELLER` intent: the personal phone
 * (required for sellers) and the spec 06 application, which creates the shop
 * as `PENDING` in the same transaction.
 */
export const sellerAccountSetupSchema = z.strictObject({ phone: rawPhone, shop: shopCreateSchema });
export type SellerAccountSetupInput = z.output<typeof sellerAccountSetupSchema>;

/**
 * The account's own personal profile (AT-1, Q2): every type has one. `phone`
 * is unverified contact information in E.164, required for Buyers and Sellers
 * and optional (`null`) for Administrators (Q3).
 */
export interface AccountProfile {
  id: string;
  fullName: string | null;
  preferredLocale: Locale;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Response of `POST /api/v1/accounts/me/setup` and `GET`/`PATCH /api/v1/accounts/me`. */
export interface AccountProfileResponse {
  userId: string;
  accountType: AccountType;
  profile: AccountProfile;
}

/** `GET /api/v1/auth/session` (AT-1; replaces the role list). */
export interface AccountSessionResponse {
  userId: string;
  accountType: AccountType;
}

/**
 * AT-1 error codes.
 *
 * - `ACCOUNT_TYPE_CONFLICT` (409): the identity already has an account of
 *   another type (setup, provisioning).
 * - `REGISTRATION_INTENT_CONFLICT` (409): the identity already has a
 *   different registration intent (write-once).
 * - `REGISTRATION_INTENT_REQUIRED` (409): setup without an intent; the client
 *   asks the person to choose, records it, and retries.
 */
export const ACCOUNT_ERROR_CODES = {
  accountTypeConflict: "ACCOUNT_TYPE_CONFLICT",
  registrationIntentConflict: "REGISTRATION_INTENT_CONFLICT",
  registrationIntentRequired: "REGISTRATION_INTENT_REQUIRED",
} as const;
