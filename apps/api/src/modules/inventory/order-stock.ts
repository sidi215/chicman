import { PRODUCT_MAX_STOCK } from "@chicman/shared";

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

/** Why a return could not be applied (D1, spec 11 section 7). */
export type StockReturnSkipReason = "VARIANT_REMOVED" | "VARIANT_STRUCTURE_CHANGED" | "ABOVE_MAXIMUM";

export interface StockReturnResult {
  returned: number;
  skipped: number;
}

/** Locks products by ID, in ascending order: the lock order of carts, checkout, and seller writes. */
export async function lockProductsForStock(tx: Prisma.TransactionClient, productIds: readonly string[]): Promise<void> {
  for (const productId of [...new Set(productIds)].sort()) {
    await tx.$queryRaw`SELECT 1 FROM "Product" WHERE "id" = ${productId}::uuid FOR UPDATE`;
  }
}

/**
 * Returns a shop order's stock when it ends without delivery (`REJECTED`,
 * `CANCELLED`, `EXPIRED`, `FAILED_DELIVERY`; D1). Runs in the transaction of
 * that transition, after the shop order lock. Separate from the seller
 * `StockService`: it needs neither an editable product nor an approved seller,
 * so archived products and suspended shops get their stock back too.
 *
 * Each item writes one `RETURNED` movement. The unique (order item, type) key
 * means a second return of the same item inserts nothing and changes no
 * stock. A return that cannot be applied is recorded as skipped, with the
 * quantity and the reason, and the caller's operation still succeeds:
 * - the item's variant no longer exists → `VARIANT_REMOVED`;
 * - the item had no variant and the product now has variants → `VARIANT_STRUCTURE_CHANGED`;
 * - the stock would pass 1,000,000 → `ABOVE_MAXIMUM` (nothing is returned).
 */
export async function returnOrderStock(tx: Prisma.TransactionClient, shopOrderId: string, at: Date): Promise<StockReturnResult> {
  const items = await tx.orderItem.findMany({
    where: { shopOrderId },
    orderBy: { id: "asc" },
    select: { id: true, productId: true, variantId: true, quantity: true },
  });
  await lockProductsForStock(tx, items.map(({ productId }) => productId));

  const result: StockReturnResult = { returned: 0, skipped: 0 };
  for (const item of items) {
    const skipReason = await returnSkipReason(tx, item);
    const inserted = await tx.stockMovement.createMany({
      data: [
        {
          orderItemId: item.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          type: "RETURNED",
          applied: skipReason === null,
          skipReason,
          createdAt: at,
        },
      ],
      skipDuplicates: true,
    });
    // Already returned: never twice.
    if (inserted.count !== 1) continue;
    if (skipReason !== null) {
      result.skipped += 1;
      continue;
    }
    if (item.variantId === null) {
      await tx.$executeRaw`UPDATE "Product" SET "stock" = "stock" + ${item.quantity} WHERE "id" = ${item.productId}::uuid`;
    } else {
      await tx.$executeRaw`
        UPDATE "ProductVariant" SET "stock" = "stock" + ${item.quantity}, "updatedAt" = now()
        WHERE "id" = ${item.variantId}::uuid`;
    }
    result.returned += 1;
  }
  return result;
}

async function returnSkipReason(
  tx: Prisma.TransactionClient,
  item: { productId: string; variantId: string | null; quantity: number },
): Promise<StockReturnSkipReason | null> {
  if (item.variantId !== null) {
    const variant = await tx.productVariant.findFirst({ where: { id: item.variantId, productId: item.productId }, select: { stock: true } });
    if (variant === null) return "VARIANT_REMOVED";
    return variant.stock + item.quantity > PRODUCT_MAX_STOCK ? "ABOVE_MAXIMUM" : null;
  }
  const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId }, select: { stock: true, _count: { select: { variants: true } } } });
  if (product._count.variants > 0) return "VARIANT_STRUCTURE_CHANGED";
  return product.stock + item.quantity > PRODUCT_MAX_STOCK ? "ABOVE_MAXIMUM" : null;
}
