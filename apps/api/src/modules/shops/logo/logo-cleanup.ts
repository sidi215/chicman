import type { LogoTimingConfig } from "../../../config/env.js";
import type { PrismaClient } from "../../../lib/prisma.js";
import { storageErrorCode, type ObjectStorage } from "./object-storage.js";

export interface LogoCleanupOptions {
  prisma: PrismaClient;
  storage: ObjectStorage;
  timing: LogoTimingConfig;
  mediaPublicBaseUrl: string;
  /** Rows handled per step and run, so one run stays bounded. */
  batchSize?: number;
}

export interface LogoCleanupResult {
  expiredUploads: number;
  reclaimedToPending: number;
  reclaimedToExpired: number;
  reclaimedObjects: number;
  deletedObjects: number;
  failedObjectDeletes: number;
  deletedStagingObjects: number;
  failedStagingDeletes: number;
}

/**
 * Logo cleanup and reconciliation (spec 06). Every step is a conditional
 * update or an idempotent delete, so a run is safe to repeat and to race
 * with completions:
 *
 * 1. `PENDING` uploads past `completeBy` → `EXPIRED`.
 * 2. Abandoned `PROCESSING` uploads (lease expired) → `PENDING`
 *    (`LEASE_EXPIRED`, staging kept) before `completeBy`, `EXPIRED` after.
 * 3. `ShopLogoObject` rows still `PENDING` after the lease → `RELEASED`.
 * 4. `RELEASED` objects not referenced by any `Shop.logoUrl` are deleted
 *    and marked `DELETED`. `ACTIVE` objects are never selected.
 * 5. Staging objects of terminal uploads are deleted (`stagingDeletedAt`).
 *
 * A live lease is never touched, and staging objects of non-terminal
 * uploads are kept.
 */
export async function runLogoCleanup(options: LogoCleanupOptions): Promise<LogoCleanupResult> {
  const { prisma, storage, timing } = options;
  const batchSize = options.batchSize ?? 200;
  const baseUrl = options.mediaPublicBaseUrl.replace(/\/+$/, "");
  const leaseSeconds = timing.completionLeaseMs / 1000;

  const result: LogoCleanupResult = {
    expiredUploads: 0,
    reclaimedToPending: 0,
    reclaimedToExpired: 0,
    reclaimedObjects: 0,
    deletedObjects: 0,
    failedObjectDeletes: 0,
    deletedStagingObjects: 0,
    failedStagingDeletes: 0,
  };

  // 1. Never-completed uploads.
  result.expiredUploads = await prisma.$executeRaw`
    UPDATE "ShopLogoUpload" SET "status" = 'EXPIRED', "updatedAt" = now()
    WHERE "status" = 'PENDING' AND "completeBy" < now()`;

  // 2. Abandoned PROCESSING uploads, reclaimed on the values read.
  const abandoned = await prisma.$queryRaw<{ id: string; attempt: number }[]>`
    SELECT "id", "attempt" FROM "ShopLogoUpload"
    WHERE "status" = 'PROCESSING' AND "leaseExpiresAt" < now()
    ORDER BY "leaseExpiresAt" LIMIT ${batchSize}`;
  for (const upload of abandoned) {
    const toPending = await prisma.$executeRaw`
      UPDATE "ShopLogoUpload"
      SET "status" = 'PENDING', "lastErrorCode" = 'LEASE_EXPIRED', "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${upload.id}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${upload.attempt}
        AND "leaseExpiresAt" < now() AND now() <= "completeBy"`;
    if (toPending === 1) {
      result.reclaimedToPending += 1;
      continue;
    }
    const toExpired = await prisma.$executeRaw`
      UPDATE "ShopLogoUpload"
      SET "status" = 'EXPIRED', "lastErrorCode" = 'LEASE_EXPIRED', "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${upload.id}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${upload.attempt}
        AND "leaseExpiresAt" < now() AND "completeBy" < now()`;
    // Zero rows: another actor already moved the upload; skip it.
    if (toExpired === 1) result.reclaimedToExpired += 1;
  }

  // 3. Orphaned PENDING objects. A late completion of such a row fails its
  //    `status = 'PENDING'` condition and rolls back.
  result.reclaimedObjects = await prisma.$executeRaw`
    UPDATE "ShopLogoObject" SET "status" = 'RELEASED', "releasedAt" = now()
    WHERE "status" = 'PENDING' AND "createdAt" < now() - make_interval(secs => ${leaseSeconds})`;

  // 4. Released objects: delete only when no shop references them.
  const released = await prisma.$queryRaw<{ id: string; objectKey: string }[]>`
    SELECT "id", "objectKey" FROM "ShopLogoObject"
    WHERE "status" = 'RELEASED' ORDER BY "releasedAt" NULLS FIRST, "createdAt" LIMIT ${batchSize}`;
  for (const object of released) {
    const url = `${baseUrl}/${object.objectKey}`;
    const referenced = await prisma.shop.count({ where: { logoUrl: url } });
    if (referenced > 0) continue;
    try {
      await storage.deleteMedia(object.objectKey);
    } catch (error) {
      result.failedObjectDeletes += 1;
      await prisma.$executeRaw`
        UPDATE "ShopLogoObject" SET "deleteAttempts" = "deleteAttempts" + 1, "lastDeleteError" = ${storageErrorCode(error)}
        WHERE "id" = ${object.id}::uuid AND "status" = 'RELEASED'`;
      continue;
    }
    result.deletedObjects += await prisma.$executeRaw`
      UPDATE "ShopLogoObject" SET "status" = 'DELETED', "deletedAt" = now()
      WHERE "id" = ${object.id}::uuid AND "status" = 'RELEASED'`;
  }

  // 5. Staging objects of terminal uploads only.
  const terminal = await prisma.$queryRaw<{ id: string; stagingKey: string }[]>`
    SELECT "id", "stagingKey" FROM "ShopLogoUpload"
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
      UPDATE "ShopLogoUpload" SET "stagingDeletedAt" = now()
      WHERE "id" = ${upload.id}::uuid AND "status" IN ('COMPLETED', 'REJECTED', 'EXPIRED') AND "stagingDeletedAt" IS NULL`;
  }

  return result;
}
