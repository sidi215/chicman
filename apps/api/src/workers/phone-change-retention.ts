import type { PrismaClient } from "../lib/prisma.js";

/** Retention of the customer phone change history (spec 04): 12 months. */
export const PHONE_CHANGE_RETENTION_MONTHS = 12;

export interface RetentionOptions {
  now?: Date;
  batchSize?: number;
  /** Upper bound of batches per run, so one run never holds the database for long. */
  maxBatches?: number;
}

/** The cutoff: rows created before it are deleted. */
export function phoneChangeRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - PHONE_CHANGE_RETENTION_MONTHS);
  return cutoff;
}

/**
 * Deletes phone change history rows older than 12 months, in bounded
 * batches. Idempotent: a repeated run deletes nothing new. This is the only
 * deletion path for the history; `CustomerProfile.phone` is never touched.
 * Returns the number of deleted rows.
 */
export async function purgeExpiredPhoneChanges(prisma: PrismaClient, options: RetentionOptions = {}): Promise<number> {
  const cutoff = phoneChangeRetentionCutoff(options.now ?? new Date());
  const batchSize = options.batchSize ?? 1000;
  const maxBatches = options.maxBatches ?? 100;
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "CustomerPhoneChange"
      WHERE "id" IN (
        SELECT "id" FROM "CustomerPhoneChange" WHERE "createdAt" < ${cutoff} ORDER BY "createdAt" LIMIT ${batchSize}
      )`;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
