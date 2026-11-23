import type {
  ModerationActorType,
  ModerationContentSnapshot,
  ProductCategory,
  ProductModerationAction,
  ProductModerationReason,
  ProductModerationStatus,
} from "@chicman/shared";
import { MODERATION_ERROR_CODES } from "@chicman/shared";

import type { Prisma } from "../../generated/prisma/client.js";
import { HttpError, notFound } from "../../lib/http-error.js";
import { activeImages } from "../products/product-views.js";

export const moderationConflict = (): HttpError => new HttpError(409, MODERATION_ERROR_CODES.conflict);
export const caseNotFound = (): HttpError => notFound(MODERATION_ERROR_CODES.caseNotFound);

/** The shop of a product, locked `FOR SHARE` (lock order: shop → product → case). */
export interface LockedShop {
  id: string;
  ownerUserId: string;
  status: string;
}

export interface LockedModerationProduct {
  id: string;
  shopId: string;
  name: string;
  status: string;
  moderationStatus: ProductModerationStatus;
}

export interface LockedCase {
  id: string;
  status: "OPEN" | "ACTIVE" | "CLOSED";
  outcome: "DISMISSED" | "RESTORED" | "REMOVED" | null;
}

export async function lockShopForShare(tx: Prisma.TransactionClient, shopId: string): Promise<LockedShop | null> {
  const rows = await tx.$queryRaw<LockedShop[]>`
    SELECT "id", "ownerUserId", "status"::text AS "status" FROM "Shop" WHERE "id" = ${shopId}::uuid FOR SHARE`;
  return rows[0] ?? null;
}

export async function lockProductForUpdate(tx: Prisma.TransactionClient, shopId: string, productId: string): Promise<LockedModerationProduct | null> {
  const rows = await tx.$queryRaw<LockedModerationProduct[]>`
    SELECT "id", "shopId", "name", "status"::text AS "status", "moderationStatus"::text AS "moderationStatus"
    FROM "Product" WHERE "id" = ${productId}::uuid AND "shopId" = ${shopId}::uuid FOR UPDATE`;
  return rows[0] ?? null;
}

/** The product's non-closed case, locked. At most one exists (partial unique index). */
export async function lockOpenCase(tx: Prisma.TransactionClient, productId: string): Promise<LockedCase | null> {
  const rows = await tx.$queryRaw<LockedCase[]>`
    SELECT "id", "status"::text AS "status", "outcome"::text AS "outcome" FROM "ProductModerationCase"
    WHERE "productId" = ${productId}::uuid AND "status" <> 'CLOSED' FOR UPDATE`;
  return rows[0] ?? null;
}

/**
 * The allowlisted content an event records (section 8.1): name, description,
 * category, brand, price, variants, and active image keys. Nothing else.
 */
export async function contentSnapshot(tx: Prisma.TransactionClient, productId: string): Promise<ModerationContentSnapshot> {
  const product = await tx.product.findUniqueOrThrow({
    where: { id: productId },
    select: {
      name: true,
      description: true,
      category: true,
      brand: true,
      price: true,
      variants: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { size: true, color: true, stock: true } },
      images: { ...activeImages, select: { objectKey: true } },
    },
  });
  return {
    name: product.name,
    description: product.description,
    category: product.category as ProductCategory,
    brand: product.brand,
    price: product.price.toFixed(2),
    variants: product.variants.map(({ size, color, stock }) => ({ size, color, stock })),
    imageKeys: product.images.map(({ objectKey }) => objectKey),
  };
}

export interface ModerationEventRecord {
  productId: string;
  caseId: string;
  action: ProductModerationAction;
  fromStatus: ProductModerationStatus | null;
  toStatus: ProductModerationStatus | null;
  actorType: ModerationActorType;
  actorUserId: string;
  sellerReasonCode?: ProductModerationReason | null;
  sellerMessage?: string | null;
  sellerNote?: string | null;
  internalReason?: string | null;
  internalNote?: string | null;
}

/** Appends one event, with the content as it is now. Returns its ID. */
export async function appendModerationEvent(tx: Prisma.TransactionClient, record: ModerationEventRecord): Promise<string> {
  const snapshot = await contentSnapshot(tx, record.productId);
  const event = await tx.productModerationEvent.create({
    data: {
      productId: record.productId,
      caseId: record.caseId,
      action: record.action,
      fromStatus: record.fromStatus,
      toStatus: record.toStatus,
      actorType: record.actorType,
      actorUserId: record.actorUserId,
      sellerReasonCode: record.sellerReasonCode ?? null,
      sellerMessage: record.sellerMessage ?? null,
      sellerNote: record.sellerNote ?? null,
      internalReason: record.internalReason ?? null,
      internalNote: record.internalNote ?? null,
      contentSnapshot: { ...snapshot },
    },
    select: { id: true },
  });
  return event.id;
}

/**
 * The conditional update of the moderation state (section 8.3). Under the
 * product lock it always matches; a mismatch means a broken invariant, and the
 * transaction is refused as a conflict.
 */
export async function setModerationStatus(
  tx: Prisma.TransactionClient,
  productId: string,
  expected: ProductModerationStatus,
  next: ProductModerationStatus,
): Promise<void> {
  const updated = await tx.product.updateMany({
    where: { id: productId, moderationStatus: expected },
    data: { moderationStatus: next, moderationUpdatedAt: new Date() },
  });
  if (updated.count !== 1) throw moderationConflict();
}
