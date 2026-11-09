import { z } from "zod";

import type { AddressLocationSource } from "../addresses/address.js";
import type { CartItem, CartItemIssueCode } from "../cart/cart.js";
import { CART_MAX_ITEMS } from "../cart/cart.js";
import { moneyAmountSchema } from "../money.js";
import type { PaymentMethod } from "../orders/orders.js";
import { plainText } from "../shops/schemas.js";

/** Checkout (spec 10). Cash on delivery only; the API decides every figure. */

export const RECIPIENT_NAME_MAX_LENGTH = 100;

/** Plain text, 1–100 characters (D11). Stored only on the order. */
export const recipientNameSchema = plainText(1, RECIPIENT_NAME_MAX_LENGTH);

/** `Idempotency-Key` header: a client-generated UUID, new for each attempt the customer starts. */
export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const idempotencyKeySchema = z.uuid();

/** `GET /customers/me/checkout?addressId=`. Without it, the default address is used. */
export const checkoutSummaryQuerySchema = z.strictObject({ addressId: z.uuid().optional() });

/**
 * `POST /customers/me/checkout`. `expected` holds the figures the customer was
 * shown. They are a precondition only: compared with the server's figures and
 * never stored. A price, stock, shop owner, or fee of the client's is refused
 * by the strict schema.
 */
export const checkoutPlacementSchema = z.strictObject({
  addressId: z.uuid(),
  recipientName: recipientNameSchema,
  expected: z.strictObject({
    total: moneyAmountSchema,
    shops: z
      .array(
        z.strictObject({
          shopId: z.uuid(),
          productsSubtotal: moneyAmountSchema,
          deliveryFee: moneyAmountSchema,
        }),
      )
      .min(1)
      .max(CART_MAX_ITEMS),
  }),
});
export type CheckoutPlacementInput = z.output<typeof checkoutPlacementSchema>;

/**
 * Stable error codes of the checkout endpoints.
 *
 * - `CHECKOUT_BLOCKED` (409): a line has a blocking problem; read the summary.
 * - `CHECKOUT_TOTALS_CHANGED` (409): a figure the customer was shown differs from the server's.
 * - `CHECKOUT_CART_EMPTY` (409): the cart is empty (also after a successful placement).
 * - `CHECKOUT_IDEMPOTENCY_KEY_INVALID` (400): the `Idempotency-Key` header is missing or not a UUID.
 * - `ADDRESS_NOT_FOUND` (404): unknown address, or another customer's.
 */
export const CHECKOUT_ERROR_CODES = {
  blocked: "CHECKOUT_BLOCKED",
  totalsChanged: "CHECKOUT_TOTALS_CHANGED",
  cartEmpty: "CHECKOUT_CART_EMPTY",
  idempotencyKeyInvalid: "CHECKOUT_IDEMPOTENCY_KEY_INVALID",
} as const;

/**
 * Why the whole checkout is blocked (spec 10, section 8). Checkout never fixes
 * a line itself: each problem is resolved in the cart.
 *
 * - Cart issue codes: the line's problem, as the cart reports it. `PRICE_CHANGED`
 *   blocks here until the customer accepts the price.
 * - `DELIVERY_FEE_NOT_SET`: the shop has no delivery fee yet.
 * - `OWN_SHOP`: the customer owns the shop (O2).
 * - `CART_EMPTY`: nothing to order.
 */
export type CheckoutProblem =
  | { code: CartItemIssueCode; shopId: string; itemId: string }
  | { code: "DELIVERY_FEE_NOT_SET" | "OWN_SHOP"; shopId: string }
  | { code: "CART_EMPTY" };
export type CheckoutProblemCode = CheckoutProblem["code"];

/** The saved address resolved for this checkout, as it would be copied onto the order. */
export interface CheckoutAddress {
  addressId: string;
  label: string | null;
  city: string;
  district: string;
  landmark: string;
  /** The address's delivery phone, otherwise the profile phone. Unverified. */
  deliveryPhone: string;
  latitude: number;
  longitude: number;
  locationSource: AddressLocationSource;
  accuracyMeters: number | null;
}

export interface CheckoutShop {
  shop: { id: string; name: string };
  /** The cart's lines for this shop, with their issues. */
  items: CartItem[];
  productsSubtotal: string;
  /** `null` while the shop has not set its fee. */
  deliveryFee: string | null;
  /** Products subtotal plus fee; `null` while the fee is not set. */
  total: string | null;
}

/** `GET /customers/me/checkout`. Writes nothing. */
export interface CheckoutSummary {
  shops: CheckoutShop[];
  itemCount: number;
  productsSubtotal: string;
  /** `null` while any shop has no fee. */
  deliveryFeeTotal: string | null;
  /** The amount payable on delivery; `null` while any shop has no fee. */
  total: string | null;
  /** `null` when the customer has no saved address: one is required. */
  address: CheckoutAddress | null;
  /** Pre-filled from the profile name, editable for this order. */
  defaultRecipientName: string;
  paymentMethod: PaymentMethod;
  problems: CheckoutProblem[];
}

/** The `expected` figures of a placement, built from the summary the customer is shown. */
export function expectedFigures(summary: CheckoutSummary): CheckoutPlacementInput["expected"] | null {
  if (summary.total === null) return null;
  const shops: CheckoutPlacementInput["expected"]["shops"] = [];
  for (const { shop, productsSubtotal, deliveryFee } of summary.shops) {
    if (deliveryFee === null) return null;
    shops.push({ shopId: shop.id, productsSubtotal, deliveryFee });
  }
  return { total: summary.total, shops };
}
