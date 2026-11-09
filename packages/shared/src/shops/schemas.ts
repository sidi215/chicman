import { z } from "zod";

import { normalizePhoneNumber } from "../auth/phone.js";
import { moneyAmountSchema } from "../money.js";
import {
  DECISION_REASON_MAX_LENGTH,
  DECISION_REASON_MIN_LENGTH,
  INTERNAL_NOTE_MAX_LENGTH,
  LOGO_CONTENT_TYPES,
  LOGO_MAX_UPLOAD_BYTES,
  SHOP_FIELD_LIMITS,
} from "./constants.js";

/**
 * Validation schemas of spec 06. Every object schema is strict: unknown or
 * protected fields (`id`, `ownerUserId`, `status`, roles, decision metadata,
 * timestamps…) fail validation instead of being dropped.
 */

/** C0 and C1 control characters. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
/** Control characters other than the line feed. */
const CONTROL_CHARACTERS_EXCEPT_LINE_FEED = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

/**
 * Plain text: Unicode NFC, trimmed, `min`–`max` characters after trimming,
 * no control characters (line breaks only when `multiline`).
 */
export function plainText(min: number, max: number, options: { multiline?: boolean } = {}) {
  const forbidden = options.multiline === true ? CONTROL_CHARACTERS_EXCEPT_LINE_FEED : CONTROL_CHARACTERS;
  return z
    .string()
    .max(max * 4)
    .transform((value) => {
      const normalized = value.normalize("NFC");
      return (options.multiline === true ? normalized.replace(/\r\n?/g, "\n") : normalized).trim();
    })
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !forbidden.test(value), { message: "control characters are not allowed" }),
    );
}

/** A phone number normalized to E.164 (`+` and 8–15 digits). */
export const shopPhoneSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const phone = normalizePhoneNumber(value);
    if (phone === null) {
      ctx.addIssue({ code: "custom", message: "invalid phone number" });
      return z.NEVER;
    }
    return phone;
  });

const shopName = plainText(1, SHOP_FIELD_LIMITS.shopName);
const description = plainText(1, SHOP_FIELD_LIMITS.description, { multiline: true });
const city = plainText(1, SHOP_FIELD_LIMITS.city);
const address = plainText(1, SHOP_FIELD_LIMITS.address);

/**
 * `POST /api/v1/sellers/me/shop` (initial application submission). Every
 * required field; no logo (a logo is uploaded once the shop exists).
 */
export const shopCreateSchema = z.strictObject({
  shopName,
  description,
  contactPhone: shopPhoneSchema,
  city,
  address,
  whatsappPhone: shopPhoneSchema.nullable().optional(),
});
export type ShopCreateInput = z.output<typeof shopCreateSchema>;

/**
 * `PATCH /api/v1/sellers/me/shop`: any non-empty subset. `whatsappPhone: null`
 * clears it; `logoUrl` accepts only `null` (removes the logo). Which fields
 * are allowed also depends on the shop status (checked by the API).
 */
export const shopUpdateSchema = z
  .strictObject({
    shopName: shopName.optional(),
    description: description.optional(),
    contactPhone: shopPhoneSchema.optional(),
    city: city.optional(),
    address: address.optional(),
    whatsappPhone: shopPhoneSchema.nullable().optional(),
    logoUrl: z.null().optional(),
    /**
     * The flat delivery fee in MRU (D2): `0.00` is free delivery. Once set it can
     * be changed but never cleared, so `null` is refused.
     */
    deliveryFee: moneyAmountSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });
export type ShopUpdateInput = z.output<typeof shopUpdateSchema>;

/** `POST /api/v1/sellers/me/shop/change-requests`: at least one field. */
export const shopChangeRequestCreateSchema = z
  .strictObject({ shopName: shopName.optional(), city: city.optional() })
  .refine((value) => value.shopName !== undefined || value.city !== undefined, {
    message: "at least one field is required",
  });
export type ShopChangeRequestCreateInput = z.output<typeof shopChangeRequestCreateSchema>;

/** `POST /api/v1/sellers/me/shop/logo/uploads`. Declared values only restrict the upload. */
export const logoUploadRequestSchema = z.strictObject({
  contentType: z.enum(LOGO_CONTENT_TYPES),
  contentLength: z.number().int().min(1).max(LOGO_MAX_UPLOAD_BYTES),
});
export type LogoUploadRequestInput = z.output<typeof logoUploadRequestSchema>;

const decisionReason = plainText(DECISION_REASON_MIN_LENGTH, DECISION_REASON_MAX_LENGTH);
const internalNote = plainText(1, INTERNAL_NOTE_MAX_LENGTH);

/**
 * Approval, suspension, reinstatement, and change-request decisions: one
 * required internal reason. `applicantReason` is refused.
 */
export const internalDecisionSchema = z.strictObject({
  internalReason: decisionReason,
  internalNote: internalNote.optional(),
});
export type InternalDecisionInput = z.output<typeof internalDecisionSchema>;

/**
 * Initial application rejection: `applicantReason` is the only reason (audit
 * reason and owner-facing explanation). `internalReason` is refused.
 */
export const applicationRejectionSchema = z.strictObject({
  applicantReason: decisionReason,
  internalNote: internalNote.optional(),
});
export type ApplicationRejectionInput = z.output<typeof applicationRejectionSchema>;
