import type { Prisma } from "../../generated/prisma/client.js";

/**
 * The single definition of a publicly visible product (spec 07, spec 08,
 * spec 19): `PUBLISHED`, in an `APPROVED` shop, with at least one image to
 * display, and not moderated (`moderationStatus = CLEAR`). Every public query
 * (`catalog.service.ts`) filters with this, so a suspended shop's products and
 * moderated products disappear without changing their seller status.
 *
 * Stock is deliberately not part of it: a published product with no stock
 * stays visible and is identified as unavailable. Availability is applied
 * separately (`modules/inventory/availability.ts`). Purchasing is refused by
 * stock validation in the cart and checkout (specs 09 and 10).
 */
export const PUBLIC_PRODUCT_WHERE = {
  status: "PUBLISHED",
  moderationStatus: "CLEAR",
  shop: { status: "APPROVED" },
  images: { some: { status: "ACTIVE" } },
} as const satisfies Prisma.ProductWhereInput;

/**
 * `PUBLIC_PRODUCT_WHERE` for a product already loaded, naming the first
 * condition it fails. Keep the two together: this is the same rule, not a
 * second one.
 *
 * `MODERATED` is internal (spec 19): it is never sent to a client. Consumers
 * must handle every value exhaustively (`assertNever`), never with an `if`
 * chain that lets a new value fall through as purchasable.
 */
export const PRODUCT_VISIBILITIES = ["PUBLIC", "MODERATED", "SHOP_NOT_APPROVED", "ARCHIVED", "NOT_PUBLISHED"] as const;
export type ProductVisibility = (typeof PRODUCT_VISIBILITIES)[number];

export interface VisibilityInput {
  status: string;
  moderationStatus: string;
  shopStatus: string;
  hasActiveImage: boolean;
}

export function productVisibility(product: VisibilityInput): ProductVisibility {
  // First: a moderated product is hidden whatever else holds, and shows no image.
  if (product.moderationStatus !== PUBLIC_PRODUCT_WHERE.moderationStatus) return "MODERATED";
  if (product.shopStatus !== PUBLIC_PRODUCT_WHERE.shop.status) return "SHOP_NOT_APPROVED";
  if (product.status === "ARCHIVED") return "ARCHIVED";
  if (product.status !== PUBLIC_PRODUCT_WHERE.status || !product.hasActiveImage) return "NOT_PUBLISHED";
  return "PUBLIC";
}

/** Whether a product's image may be shown outside order history (spec 19, acceptance 1). */
export function mayShowProductImage(product: { moderationStatus: string }): boolean {
  return product.moderationStatus === PUBLIC_PRODUCT_WHERE.moderationStatus;
}

/** Compile-time exhaustiveness for `switch` statements over a union. */
export function assertNever(value: never): never {
  throw new Error(`Unhandled value: ${String(value)}`);
}
