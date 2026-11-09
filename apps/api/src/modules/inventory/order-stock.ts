import type { Prisma } from "../../generated/prisma/client.js";

/** One order item's claim on stock. */
export interface OrderStockLine {
  orderItemId: string;
  productId: string;
  /** `null`: the product's own stock (a product without variants). */
  variantId: string | null;
  quantity: number;
}

/** The stock of a line could not be taken: the caller rolls the whole placement back. */
export class OrderStockUnavailableError extends Error {
  constructor(readonly productId: string) {
    super("order stock unavailable");
    this.name = "OrderStockUnavailableError";
  }
}

/**
 * Takes stock for an order at placement (D1, spec 11 section 7). Separate from
 * the seller `StockService`, which stays the only way a seller edits stock.
 *
 * Each line is a conditional update that lowers the stock only if enough
 * remains, so two checkouts can never oversell, whatever they validated
 * earlier. Each take is recorded as a `TAKEN` movement; the unique
 * (order item, type) key means an item's stock is taken once. Throws
 * `OrderStockUnavailableError` on the first line that cannot be taken; the
 * caller's transaction then rolls back every earlier take.
 *
 * The caller holds the product rows locked (`FOR UPDATE`, ordered by ID), the
 * lock order of carts, seller writes, and orders: cart, shop, product.
 */
export async function takeOrderStock(tx: Prisma.TransactionClient, lines: readonly OrderStockLine[]): Promise<void> {
  for (const line of lines) {
    const taken =
      line.variantId === null
        ? await tx.$executeRaw`
            UPDATE "Product" SET "stock" = "stock" - ${line.quantity}
            WHERE "id" = ${line.productId}::uuid AND "stock" >= ${line.quantity}
              AND NOT EXISTS (SELECT 1 FROM "ProductVariant" WHERE "productId" = ${line.productId}::uuid)`
        : await tx.$executeRaw`
            UPDATE "ProductVariant" SET "stock" = "stock" - ${line.quantity}, "updatedAt" = now()
            WHERE "id" = ${line.variantId}::uuid AND "productId" = ${line.productId}::uuid AND "stock" >= ${line.quantity}`;
    if (taken !== 1) throw new OrderStockUnavailableError(line.productId);
  }
  await tx.stockMovement.createMany({
    data: lines.map((line) => ({
      orderItemId: line.orderItemId,
      productId: line.productId,
      variantId: line.variantId,
      quantity: line.quantity,
      type: "TAKEN" as const,
      applied: true,
    })),
  });
}
