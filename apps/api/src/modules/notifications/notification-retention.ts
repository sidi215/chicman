import type { PrismaClient } from "../../lib/prisma.js";

/** Notifications are kept 365 days after their creation (spec 15, O6.3). */
export const NOTIFICATION_RETENTION_DAYS = 365;

const DAY_MS = 24 * 60 * 60_000;

export interface NotificationRetentionOptions {
  now?: Date;
  batchSize?: number;
  /** Upper bound of batches per run, so one run never holds the database for long. */
  maxBatches?: number;
}

/** Notifications created before this instant are eligible for deletion. */
export function notificationRetentionCutoff(now: Date): Date {
  return new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
}

/**
 * Deletes notifications older than 365 days, read or unread, oldest first, in
 * bounded batches: each batch is its own short statement, and a run stops
 * after `maxBatches`, leaving any backlog to the next run.
 *
 * Only `Notification` rows are deleted. Nothing references them, so no order,
 * delivery, payment, or other business record is touched. The event-key
 * ledger (`NotificationEvent`) is never purged, so a deleted notification's
 * event can never be recorded again. Idempotent: a repeated or concurrent run
 * deletes nothing more. Returns the number of deleted notifications.
 */
export async function purgeExpiredNotifications(prisma: PrismaClient, options: NotificationRetentionOptions = {}): Promise<number> {
  const cutoff = notificationRetentionCutoff(options.now ?? new Date());
  const batchSize = options.batchSize ?? 1000;
  const maxBatches = options.maxBatches ?? 100;
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const deleted = await prisma.$executeRaw`
      DELETE FROM "Notification"
      WHERE "id" IN (
        SELECT "id" FROM "Notification" WHERE "createdAt" < ${cutoff} ORDER BY "createdAt", "id" LIMIT ${batchSize}
      )`;
    total += deleted;
    if (deleted < batchSize) break;
  }
  return total;
}
