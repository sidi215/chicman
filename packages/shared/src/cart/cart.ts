import { z } from "zod";

import { PRODUCT_MAX_STOCK, productPriceSchema } from "../products/product.js";

/** Shopping cart (spec 09). */

/** Distinct lines in one cart: far above a real purchase, and it bounds every cart read. */
export const CART_MAX_ITEMS = 100;

/** A positive integer. Whether that much is in stock is decided by the API. */
export const cartQuantitySchema = z.number().int().min(1).max(PRODUCT_MAX_STOCK);

/*
 * Strict schemas: a price, a shop, a stock value, or an owner in the body fails
 * validation. The API reads all of them from PostgreSQL.
 */

/** `POST /customers/me/cart/items`. Adding a line that exists raises its quantity. */
export const cartItemAddSchema = z.strictObject({
  productId: z.uuid(),
  /** Required when the product has variants, refused when it has none. */
  variantId: z.uuid().optional(),
  quantity: cartQuantitySchema,
});
export type CartItemAddInput = z.output<typeof cartItemAddSchema>;

/** `PATCH /customers/me/cart/items/:itemId`. The new quantity, never a difference. */
export const cartItemUpdateSchema = z.strictObject({ quantity: cartQuantitySchema });
export type CartItemUpdateInput = z.output<typeof cartItemUpdateSchema>;

/**
 * `POST /customers/me/cart/items/:itemId/accept-price`. The price the customer
 * was shown. It only confirms what they saw: the API compares it with the
 * current price and never stores it from here.
 */
export const cartItemAcceptPriceSchema = z.strictObject({ price: productPriceSchema });
export type CartItemAcceptPriceInput = z.output<typeof cartItemAcceptPriceSchema>;

/**
 * Stable error codes of the cart endpoints.
 *
 * - `CART_ITEM_NOT_FOUND` (404): absent, or another customer's line (never disclosed).
 * - `CART_VARIANT_NOT_FOUND` (404): the variant does not belong to the product.
 * - `CART_VARIANT_REQUIRED` (409): the product has variants and none was chosen.
 * - `CART_INSUFFICIENT_STOCK` (409): the quantity is above the available stock.
 * - `CART_ITEM_UNAVAILABLE` (409): the line can only be removed (see the item's issues).
 * - `CART_PRICE_CHANGED` (409): the price changed again; read the cart and show it.
 * - `CART_LIMIT_REACHED` (409): the cart holds `CART_MAX_ITEMS` lines.
 *
 * Adding a product that is not publicly visible gives `PRODUCT_NOT_FOUND`, as in the catalog.
 */
export const CART_ERROR_CODES = {
  itemNotFound: "CART_ITEM_NOT_FOUND",
  variantNotFound: "CART_VARIANT_NOT_FOUND",
  variantRequired: "CART_VARIANT_REQUIRED",
  insufficientStock: "CART_INSUFFICIENT_STOCK",
  itemUnavailable: "CART_ITEM_UNAVAILABLE",
  priceChanged: "CART_PRICE_CHANGED",
  limitReached: "CART_LIMIT_REACHED",
} as const;

/**
 * Why a line needs the customer's attention. Nothing changes a quantity or a
 * variant on its own: the customer updates or removes the line.
 *
 * - `SHOP_UNAVAILABLE`, `PRODUCT_ARCHIVED`, `PRODUCT_UNPUBLISHED`,
 *   `VARIANT_UNAVAILABLE`: the line can only be removed.
 * - `INSUFFICIENT_STOCK`: `availableQuantity` is what can be bought now (`0` when
 *   sold out). This is the one place a stock figure is shown, and only for a
 *   line already above it, so the customer can correct the quantity.
 * - `PRICE_CHANGED`: informative, until the customer accepts the price or
 *   removes the line. It does not stop the line counting in the subtotal.
 */
export const CART_ITEM_ISSUE_CODES = [
  "SHOP_UNAVAILABLE",
  "PRODUCT_ARCHIVED",
  "PRODUCT_UNPUBLISHED",
  "VARIANT_UNAVAILABLE",
  "INSUFFICIENT_STOCK",
  "PRICE_CHANGED",
] as const;
export type CartItemIssueCode = (typeof CART_ITEM_ISSUE_CODES)[number];

export type CartItemIssue =
  | { code: "SHOP_UNAVAILABLE" | "PRODUCT_ARCHIVED" | "PRODUCT_UNPUBLISHED" | "VARIANT_UNAVAILABLE" }
  | { code: "INSUFFICIENT_STOCK"; availableQuantity: number }
  | { code: "PRICE_CHANGED"; previousPrice: string };

export interface CartItem {
  id: string;
  productId: string;
  variantId: string | null;
  name: string;
  /** Can be missing only on a line whose product is no longer public. */
  imageUrl: string | null;
  /** The size and color the customer chose, even if the variant no longer exists. */
  size: string | null;
  color: string | null;
  quantity: number;
  /**
   * Decimal string in MRU. The current price; on a line that can only be
   * removed, the last price the customer saw.
   */
  unitPrice: string;
  subtotal: string;
  /** `true` when the line has no issue other than a price change. */
  purchasable: boolean;
  issues: CartItemIssue[];
}

export interface CartShopGroup {
  shop: { id: string; name: string };
  items: CartItem[];
  /** The purchasable lines of this shop. */
  subtotal: string;
}

/** Calculated from current server prices every time it is read or changed. */
export interface Cart {
  shops: CartShopGroup[];
  /** Units across all lines, for the cart icon. */
  itemCount: number;
  /** All purchasable lines. A line with a blocking issue is not counted. */
  subtotal: string;
}
