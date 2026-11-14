import {
  API_ERROR_CODES,
  buyerAccountSetupSchema,
  registrationIntentSchema,
  sellerAccountSetupSchema,
  type RegistrableAccountType,
  type RegistrationIntentInput,
  FULL_NAME_MAX_LENGTH,
  LOCALES,
  normalizePhoneNumber,
  type Locale,
} from "@chicman/shared";
import { z } from "zod";

import { badRequest } from "../../lib/http-error.js";
import type { SetupRequest } from "./account.repository.js";

/** Control characters are rejected in text fields. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

// Bound the raw input before normalizing.
const rawPhone = z.string().max(32);

const fullName = z
  .string()
  .max(FULL_NAME_MAX_LENGTH * 2)
  .transform((value) => value.normalize("NFC").trim())
  .pipe(
    z
      .string()
      .min(1)
      .max(FULL_NAME_MAX_LENGTH)
      .refine((value) => !CONTROL_CHARACTERS.test(value)),
  );

/** `PATCH /accounts/me`: the allowlist (spec 04), at least one field. No account type, role, or ownership field. */
const updateSchema = z
  .strictObject({
    fullName: fullName.optional(),
    preferredLocale: z.enum(LOCALES).optional(),
    phone: rawPhone.optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

export interface ProfileChanges {
  fullName?: string;
  preferredLocale?: Locale;
  phone?: string;
}

/** Normalizes to E.164 or throws `400 INVALID_PHONE`. */
function toE164(input: string): string {
  const phone = normalizePhoneNumber(input);
  if (phone === null) throw badRequest(API_ERROR_CODES.invalidPhone);
  return phone;
}

/**
 * The setup body for the identity's intended type (AT-1). Unknown or protected
 * fields (including any account type) and invalid values → `400`; an invalid
 * personal phone → `400 INVALID_PHONE`. Nothing is written.
 */
export function parseSetupBody(accountType: RegistrableAccountType, body: unknown): SetupRequest {
  if (accountType === "BUYER") {
    const result = buyerAccountSetupSchema.safeParse(body);
    if (!result.success) throw badRequest();
    return { accountType, phone: toE164(result.data.phone) };
  }
  const result = sellerAccountSetupSchema.safeParse(body);
  if (!result.success) throw badRequest();
  return { accountType, phone: toE164(result.data.phone), shop: result.data.shop };
}

/** `POST /registration-intents` body, or `400`. */
export function parseIntentBody(body: unknown): RegistrationIntentInput {
  const result = registrationIntentSchema.safeParse(body);
  if (!result.success) throw badRequest();
  return result.data;
}

export function parseProfileUpdate(body: unknown): ProfileChanges {
  const result = updateSchema.safeParse(body);
  if (!result.success) throw badRequest();
  const { fullName: name, preferredLocale, phone } = result.data;
  const changes: ProfileChanges = {};
  if (name !== undefined) changes.fullName = name;
  if (preferredLocale !== undefined) changes.preferredLocale = preferredLocale;
  if (phone !== undefined) changes.phone = toE164(phone);
  return changes;
}
