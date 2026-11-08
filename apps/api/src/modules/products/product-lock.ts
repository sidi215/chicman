import { PRODUCT_ERROR_CODES, type ProductStatus } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { forbidden, HttpError, notFound } from "../../lib/http-error.js";
import type { PrismaClient } from "../../lib/prisma.js";

/** The approved seller, always resolved from the authenticated user. */
export interface ProductSeller {
  userId: string;
  shopId: string;
}

export interface LockedProduct {
  id: string;
  status: ProductStatus;
  stock: number;
}

export const productNotFound = (): HttpError => notFound(PRODUCT_ERROR_CODES.notFound);
export const productArchived = (): HttpError => new HttpError(409, PRODUCT_ERROR_CODES.archived);

/**
 * Re-checks the shop status inside the transaction. The shared lock makes a
 * suspension wait for this transaction, so nothing can be published or
 * changed by a shop that is no longer `APPROVED`.
 */
export async function isShopStillApproved(tx: Prisma.TransactionClient, shopId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT "status"::text AS "status" FROM "Shop" WHERE "id" = ${shopId}::uuid FOR SHARE`;
  return rows[0]?.status === "APPROVED";
}

/**
 * Locks a product of this shop. Lock order everywhere: shop, then product.
 * A product of another shop is the same as a missing one.
 */
export async function lockProduct(tx: Prisma.TransactionClient, shopId: string, productId: string): Promise<LockedProduct | null> {
  const rows = await tx.$queryRaw<LockedProduct[]>`
    SELECT "id", "status"::text AS "status", "stock" FROM "Product"
    WHERE "id" = ${productId}::uuid AND "shopId" = ${shopId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * Runs a product change in one transaction, holding the shop and product
 * locks. All writes to a product, its variants, and its images are therefore
 * serialized, so counts and stock checks stay valid until the commit.
 */
export function withLockedProduct<T>(
  prisma: PrismaClient,
  seller: ProductSeller,
  productId: string,
  change: (tx: Prisma.TransactionClient, product: LockedProduct) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    if (!(await isShopStillApproved(tx, seller.shopId))) throw forbidden();
    const product = await lockProduct(tx, seller.shopId, productId);
    if (product === null) throw productNotFound();
    return change(tx, product);
  });
}

/** As `withLockedProduct`, refusing archived products: they are read-only. */
export function withEditableProduct<T>(
  prisma: PrismaClient,
  seller: ProductSeller,
  productId: string,
  change: (tx: Prisma.TransactionClient, product: LockedProduct) => Promise<T>,
): Promise<T> {
  return withLockedProduct(prisma, seller, productId, async (tx, product) => {
    if (product.status === "ARCHIVED") throw productArchived();
    return change(tx, product);
  });
}

/** Marks the product as changed when only a child row (variant, image) changed. */
export async function touchProduct(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
}
