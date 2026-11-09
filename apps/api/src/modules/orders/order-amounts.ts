import { Prisma } from "../../generated/prisma/client.js";

/**
 * The one calculation of order amounts (spec 10 section 7, spec 11). Checkout
 * uses it for the summary, for the comparison with the figures the customer
 * was shown, and for the stored amounts, so they cannot disagree.
 */

export interface PricedLine {
  unitPrice: Prisma.Decimal;
  quantity: number;
}

export interface ShopOrderAmounts {
  productsSubtotal: Prisma.Decimal;
  deliveryFee: Prisma.Decimal;
  /** Products subtotal plus the fee, charged once per shop order (D2). */
  total: Prisma.Decimal;
}

export interface OrderAmounts {
  productsSubtotal: Prisma.Decimal;
  deliveryFeeTotal: Prisma.Decimal;
  total: Prisma.Decimal;
}

export const lineTotal = ({ unitPrice, quantity }: PricedLine): Prisma.Decimal => unitPrice.times(quantity);

export function productsSubtotal(lines: readonly PricedLine[]): Prisma.Decimal {
  return lines.reduce((sum, line) => sum.plus(lineTotal(line)), new Prisma.Decimal(0));
}

export function shopOrderAmounts(lines: readonly PricedLine[], deliveryFee: Prisma.Decimal): ShopOrderAmounts {
  const subtotal = productsSubtotal(lines);
  return { productsSubtotal: subtotal, deliveryFee, total: subtotal.plus(deliveryFee) };
}

export function orderAmounts(shops: readonly ShopOrderAmounts[]): OrderAmounts {
  const zero = new Prisma.Decimal(0);
  const productsSubtotal = shops.reduce((sum, shop) => sum.plus(shop.productsSubtotal), zero);
  const deliveryFeeTotal = shops.reduce((sum, shop) => sum.plus(shop.deliveryFee), zero);
  return { productsSubtotal, deliveryFeeTotal, total: productsSubtotal.plus(deliveryFeeTotal) };
}
