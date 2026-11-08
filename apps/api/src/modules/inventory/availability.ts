/**
 * The single definition of stock availability (spec 07, section 7). It is
 * derived from current stock on every read and never stored, so replenishing
 * stock makes a product available again without republishing it.
 *
 * Availability is separate from publication visibility (`PUBLIC_PRODUCT_WHERE`):
 * a published product at zero stock stays visible and is marked unavailable.
 */
export function isStockAvailable(stock: number): boolean {
  return stock > 0;
}

export interface ProductAvailability {
  /** Sum of the variants' stock when the product has variants, else its own stock. */
  stock: number;
  available: boolean;
}

export function productAvailability(ownStock: number, variants: readonly { stock: number }[]): ProductAvailability {
  const stock = variants.length > 0 ? variants.reduce((total, variant) => total + variant.stock, 0) : ownStock;
  return { stock, available: isStockAvailable(stock) };
}
