import { z } from "zod";

import { SHOP_STATUSES } from "../auth/roles.js";
import { plainText } from "../shops/schemas.js";

/**
 * Administrator dashboard list contracts (spec 17): search, filters, and
 * pagination of the administrative lists. Every list is ordered on the server
 * and paginated with `page` / `pageSize`.
 */

export const ADMIN_LIST_DEFAULT_PAGE_SIZE = 20;
export const ADMIN_LIST_MAX_PAGE_SIZE = 50;

/** A free-text search: plain text, trimmed, 1–100 characters. Clients omit an empty search. */
export const ADMIN_SEARCH_MAX_LENGTH = 100;
export const adminSearchSchema = plainText(1, ADMIN_SEARCH_MAX_LENGTH);

const page = z.coerce.number().int().min(1).max(1_000_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(ADMIN_LIST_MAX_PAGE_SIZE).default(ADMIN_LIST_DEFAULT_PAGE_SIZE);

/**
 * `GET /admin/shops`: the review queue, oldest change first. `q` matches the
 * shop name or city (case-insensitive, contains). `openChangeRequest=true`
 * keeps shops with a pending change request; `false` keeps the others.
 */
export const adminShopListQuerySchema = z.strictObject({
  status: z.enum(SHOP_STATUSES).optional(),
  openChangeRequest: z.enum(["true", "false"]).optional(),
  q: adminSearchSchema.optional(),
  page,
  pageSize,
});
export type AdminShopListQuery = z.output<typeof adminShopListQuerySchema>;

/**
 * An order reference search (`CM-7K3QX9D2RB`, spec 11): case-insensitive,
 * spaces ignored, with or without the `CM-` prefix, at least 3 characters of
 * the code. Matches references that contain it. Returns `null` when the input
 * cannot be part of a reference.
 */
export function normalizeOrderReferenceSearch(value: string): string | null {
  const compact = value.replace(/\s+/g, "").toUpperCase();
  const code = compact.startsWith("CM-") ? compact.slice(3) : compact;
  if (!/^[0-9A-Z]{3,10}$/.test(code)) return null;
  return code;
}

export const orderReferenceSearchSchema = z
  .string()
  .max(40)
  .transform((value, ctx) => {
    const code = normalizeOrderReferenceSearch(value);
    if (code === null) {
      ctx.addIssue({ code: "custom", message: "invalid order reference" });
      return z.NEVER;
    }
    return code;
  });
