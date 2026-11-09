import type { CartItemIssue } from "@chicman/shared";

import { Prisma } from "../../generated/prisma/client.js";
import { isQuantityAvailable } from "../inventory/availability.js";
import { productVisibility } from "../products/product-visibility.js";

/** What the rules need to know about a line and the current state of its product. */
export interface CartLineState {
  quantity: number;
  priceSnapshot: Prisma.Decimal;
  variantId: string | null;
  variantSize: string | null;
  variantColor: string | null;
  product: {
    status: string;
    price: Prisma.Decimal;
    stock: number;
    hasActiveImage: boolean;
    variants: readonly { id: string; size: string | null; color: string | null; stock: number }[];
  };
  shopStatus: string;
}

export interface CartLineEvaluation {
  /** The price the customer is shown and that totals use. */
  unitPrice: Prisma.Decimal;
  issues: CartItemIssue[];
  /** No issue other than a price change. */
  purchasable: boolean;
  /** The line cannot be changed, whatever the quantity: it can only be removed. */
  removeOnly: boolean;
  /** `null` while the line cannot be bought at all. */
  stock: number | null;
}

/** Variant values ignore case within a product, as the database's unique index does. */
const sameValue = (a: string | null, b: string | null): boolean => (a ?? "").toLocaleLowerCase("und") === (b ?? "").toLocaleLowerCase("und");

/**
 * The stock a line draws from, or `null` when what the customer chose no longer
 * exists as chosen: the variant was removed or renamed, or the product gained or
 * lost its variants. Never falls back to another variant.
 */
function selectedStock({ variantId, variantSize, variantColor, product }: CartLineState): number | null {
  const chose = variantId !== null || variantSize !== null || variantColor !== null;
  if (!chose) return product.variants.length === 0 ? product.stock : null;
  const variant = product.variants.find(({ id }) => id === variantId);
  if (variant === undefined || !sameValue(variant.size, variantSize) || !sameValue(variant.color, variantColor)) return null;
  return variant.stock;
}

type RemoveOnlyCode = Exclude<CartItemIssue["code"], "INSUFFICIENT_STOCK" | "PRICE_CHANGED">;

/**
 * A line that can no longer be bought shows the price the customer last saw. A
 * product's current price may not be public (a restored draft, for example), and
 * a price they cannot act on would only be noise.
 */
const removeOnlyLine = (code: RemoveOnlyCode, line: CartLineState): CartLineEvaluation => ({
  unitPrice: line.priceSnapshot,
  issues: [{ code }],
  purchasable: false,
  removeOnly: true,
  stock: null,
});

/**
 * The state of a line now (spec 09, section 7). It only reports: nothing here
 * changes a quantity, a variant, or a stored price.
 */
export function evaluateCartLine(line: CartLineState): CartLineEvaluation {
  const visibility = productVisibility({ status: line.product.status, shopStatus: line.shopStatus, hasActiveImage: line.product.hasActiveImage });
  if (visibility === "SHOP_NOT_APPROVED") return removeOnlyLine("SHOP_UNAVAILABLE", line);
  if (visibility === "ARCHIVED") return removeOnlyLine("PRODUCT_ARCHIVED", line);
  if (visibility === "NOT_PUBLISHED") return removeOnlyLine("PRODUCT_UNPUBLISHED", line);

  const stock = selectedStock(line);
  if (stock === null) return removeOnlyLine("VARIANT_UNAVAILABLE", line);

  const issues: CartItemIssue[] = [];
  const purchasable = isQuantityAvailable(stock, line.quantity);
  if (!purchasable) issues.push({ code: "INSUFFICIENT_STOCK", availableQuantity: stock });
  if (!line.product.price.equals(line.priceSnapshot)) issues.push({ code: "PRICE_CHANGED", previousPrice: line.priceSnapshot.toFixed(2) });
  return { unitPrice: line.product.price, issues, purchasable, removeOnly: false, stock };
}
