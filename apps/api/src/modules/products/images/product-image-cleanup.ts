import type { LogoTimingConfig } from "../../../config/env.js";
import type { PrismaClient } from "../../../lib/prisma.js";
import { storageErrorCode, type ObjectStorage } from "../../shops/logo/object-storage.js";

export interface ProductImageCleanupOptions {
  prisma: PrismaClient;
  storage: ObjectStorage;
  timing: LogoTimingConfig;
  /** Rows handled per step and run, so one run stays bounded. */
  batchSize?: number;
}

export interface ProductImageCleanupResult {
  expiredUploads: number;
  reclaimedToPending: number;
  reclaimedToExpired: number;
  reclaimedImages: number;
  deletedImages: number;
  failedImageDeletes: number;
  deletedStagingObjects: number;
  failedStagingDeletes: number;
}

/**
 * Product image cleanup and reconciliation, with the rules of the logo job
 * (spec 06). Every step is a conditional update or an idempotent delete, so a
 * run is safe to repeat and to race with completions:
 *
 * 1. `PENDING` uploads past `completeBy` → `EXPIRED`.
 * 2. Abandoned `PROCESSING` uploads (lease expired) → `PENDING`
 *    (`LEASE_EXPIRED`, staging kept) before `completeBy`, `EXPIRED` after.
 * 3. `ProductImage` rows still `PENDING` after the lease → `RELEASED`.
 * 4. `RELEASED` images are deleted from storage and marked `DELETED`, unless an
 *    order item references the object (S2-7): those stay `RELEASED` and are kept.
 *    `ACTIVE` images are never selected, including those of archived products.
 * 5. Staging objects of terminal uploads are deleted (`stagingDeletedAt`).
 */
export async function runProductImageCleanup(options: ProductImageCleanupOptions): Promise<ProductImageCleanupResult> {
  const { prisma, storage, timing } = options;
  const batchSize = options.batchSize ?? 200;
  const leaseSeconds = timing.completionLeaseMs / 1000;

  const result: ProductImageCleanupResult = {
    expiredUploads: 0,
    reclaimedToPending: 0,
    reclaimedToExpired: 0,
    reclaimedImages: 0,
    deletedImages: 0,
    failedImageDeletes: 0,
    deletedStagingObjects: 0,
    failedStagingDeletes: 0,
  };

  result.expiredUploads = await prisma.$executeRaw`
    UPDATE "ProductImageUpload" SET "status" = 'EXPIRED', "updatedAt" = now()
    WHERE "status" = 'PENDING' AND "completeBy" < now()`;

  const abandoned = await prisma.$queryRaw<{ id: string; attempt: number }[]>`
    SELECT "id", "attempt" FROM "ProductImageUpload"
    WHERE "status" = 'PROCESSING' AND "leaseExpiresAt" < now()
    ORDER BY "leaseExpiresAt" LIMIT ${batchSize}`;
  for (const upload of abandoned) {
    const toPending = await prisma.$executeRaw`
      UPDATE "ProductImageUpload"
      SET "status" = 'PENDING', "lastErrorCode" = 'LEASE_EXPIRED', "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${upload.id}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${upload.attempt}
        AND "leaseExpiresAt" < now() AND now() <= "completeBy"`;
    if (toPending === 1) {
      result.reclaimedToPending += 1;
      continue;
    }
    const toExpired = await prisma.$executeRaw`
      UPDATE "ProductImageUpload"
      SET "status" = 'EXPIRED', "lastErrorCode" = 'LEASE_EXPIRED', "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${upload.id}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${upload.attempt}
        AND "leaseExpiresAt" < now() AND "completeBy" < now()`;
    // Zero rows: another actor already moved the upload; skip it.
    if (toExpired === 1) result.reclaimedToExpired += 1;
  }

  // A late completion of such a row fails its `status = 'PENDING'` condition and rolls back.
  result.reclaimedImages = await prisma.$executeRaw`
    UPDATE "ProductImage" SET "status" = 'RELEASED', "releasedAt" = now()
    WHERE "status" = 'PENDING' AND "createdAt" < now() - make_interval(secs => ${leaseSeconds})`;

  const released = await prisma.$queryRaw<{ id: string; objectKey: string }[]>`
    SELECT "id", "objectKey" FROM "ProductImage" i
    WHERE "status" = 'RELEASED'
      AND NOT EXISTS (SELECT 1 FROM "OrderItem" o WHERE o."imageObjectKey" = i."objectKey")
    ORDER BY "releasedAt" NULLS FIRST, "createdAt" LIMIT ${batchSize}`;
  for (const image of released) {
    try {
      await storage.deleteMedia(image.objectKey);
    } catch (error) {
      result.failedImageDeletes += 1;
      await prisma.$executeRaw`
        UPDATE "ProductImage" SET "deleteAttempts" = "deleteAttempts" + 1, "lastDeleteError" = ${storageErrorCode(error)}
        WHERE "id" = ${image.id}::uuid AND "status" = 'RELEASED'`;
      continue;
    }
    result.deletedImages += await prisma.$executeRaw`
      UPDATE "ProductImage" SET "status" = 'DELETED', "deletedAt" = now()
      WHERE "id" = ${image.id}::uuid AND "status" = 'RELEASED'`;
  }

  const terminal = await prisma.$queryRaw<{ id: string; stagingKey: string }[]>`
    SELECT "id", "stagingKey" FROM "ProductImageUpload"
    WHERE "status" IN ('COMPLETED', 'REJECTED', 'EXPIRED') AND "stagingDeletedAt" IS NULL
    ORDER BY "updatedAt" LIMIT ${batchSize}`;
  for (const upload of terminal) {
    try {
      await storage.deleteStaging(upload.stagingKey);
    } catch {
      // `stagingDeletedAt` stays empty: the next run retries.
      result.failedStagingDeletes += 1;
      continue;
    }
    result.deletedStagingObjects += await prisma.$executeRaw`
      UPDATE "ProductImageUpload" SET "stagingDeletedAt" = now()
      WHERE "id" = ${upload.id}::uuid AND "status" IN ('COMPLETED', 'REJECTED', 'EXPIRED') AND "stagingDeletedAt" IS NULL`;
  }

  return result;
}
