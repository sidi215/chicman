import type { PublicProductSummary } from "../products/catalog.js";

/** Favorites (spec 14). */

/** Favorites per customer. Far above real use, and it bounds every favorites read. */
export const FAVORITES_MAX_ITEMS = 200;

/**
 * Stable error codes of the favorites endpoints.
 *
 * - `FAVORITE_LIMIT_REACHED` (409): the list holds `FAVORITES_MAX_ITEMS` products.
 *
 * Adding a product that is not publicly visible, or does not exist, gives
 * `PRODUCT_NOT_FOUND`, as in the catalog and the cart, so a favorite never
 * discloses a hidden product.
 */
export const FAVORITE_ERROR_CODES = {
  limitReached: "FAVORITE_LIMIT_REACHED",
} as const;

/**
 * How a favorite's product stands now, worked out on every read with the public
 * visibility and availability rules.
 *
 * - `AVAILABLE`: public and in stock.
 * - `SOLD_OUT`: public, no stock at the moment.
 * - `UNAVAILABLE`: no longer public (archived, unpublished, or its shop is not
 *   approved). No price, shop, or link is given, and the reason is not disclosed.
 */
export const FAVORITE_STATES = ["AVAILABLE", "SOLD_OUT", "UNAVAILABLE"] as const;
export type FavoriteState = (typeof FAVORITE_STATES)[number];

export interface FavoriteItem {
  productId: string;
  /** When the customer added it (ISO 8601, UTC). */
  addedAt: string;
  /** The product's current name, in the seller's language. */
  name: string;
  /** Can be missing only on an `UNAVAILABLE` product. */
  imageUrl: string | null;
  state: FavoriteState;
  /**
   * The public summary (current price, shop, availability) when the product is
   * public; `null` when `UNAVAILABLE`. A favorite keeps no price of its own.
   */
  product: PublicProductSummary | null;
}

/**
 * `GET`, `PUT /:productId`, and `DELETE /:productId` on `/customers/me/favorites`
 * all answer with the whole list, most recently added first.
 */
export interface FavoriteList {
  items: FavoriteItem[];
}
