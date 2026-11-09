import type { Prisma } from "../../generated/prisma/client.js";
import { activeImages } from "../products/product-views.js";
import type { CartLineState } from "./cart-rules.js";

/**
 * How a cart line and the current state of its product are loaded, for the cart
 * (spec 09) and for checkout (spec 10), which re-runs the same rules on it.
 */
export const cartLineProduct = {
  id: true,
  name: true,
  status: true,
  price: true,
  stock: true,
  images: { ...activeImages, take: 1, select: { objectKey: true } },
  variants: { select: { id: true, size: true, color: true, stock: true } },
  shop: { select: { id: true, shopName: true, status: true } },
} satisfies Prisma.ProductSelect;

export const cartLineInclude = { product: { select: cartLineProduct } } satisfies Prisma.CartItemInclude;

export type CartLine = Prisma.CartItemGetPayload<{ include: typeof cartLineInclude }>;

/** Oldest first, so lines and shops do not move when a quantity changes. */
export const CART_LINE_ORDER = [{ createdAt: "asc" }, { id: "asc" }] satisfies Prisma.CartItemOrderByWithRelationInput[];

export function cartLineState(line: CartLine): CartLineState {
  const { product } = line;
  return {
    quantity: line.quantity,
    priceSnapshot: line.priceSnapshot,
    variantId: line.variantId,
    variantSize: line.variantSize,
    variantColor: line.variantColor,
    product: {
      status: product.status,
      price: product.price,
      stock: product.stock,
      hasActiveImage: product.images.length > 0,
      variants: product.variants,
    },
    shopStatus: product.shop.status,
  };
}
