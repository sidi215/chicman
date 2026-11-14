import {
  API_ERROR_CODES,
  FULL_NAME_MAX_LENGTH,
  LOCALES,
  normalizePhoneNumber,
  type Locale,
} from "@chicman/shared";
import { z } from "zod";

import { badRequest } from "../../lib/http-error.js";

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

/** `POST /customers/me`: exactly one field, `phone`. */
const bootstrapSchema = z.strictObject({ phone: rawPhone });

/** `PATCH /customers/me`: the allowlist (spec 04), at least one field. */
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

/** Unknown or protected fields and invalid values → `400`, nothing is written. */
export function parseBootstrapBody(body: unknown): { phone: string } {
  const result = bootstrapSchema.safeParse(body);
  if (!result.success) throw badRequest();
  return { phone: toE164(result.data.phone) };
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
