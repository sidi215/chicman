// Background worker process (architecture.md, apps/api/src/workers/).
// Runs scheduled maintenance jobs outside the API request path:
// - phone-change history retention (spec 04), every 24 hours;
// - shop logo (spec 06) and product image (spec 07) cleanup and
//   reconciliation, each every 5 minutes, when object storage is configured;
// - shop order expiry and seller response reminders (spec 11, D7), each every
//   5 minutes;
// - automatic closure of failed deliveries (spec 12, D5), every 5 minutes;
// - notification retention (spec 15, O6.3): notifications older than 365
//   days, every 24 hours.
// In development it runs as the `worker` service of
// infrastructure/docker/docker-compose.yml (restart: unless-stopped).
import dotenv from "dotenv";

import { loadWorkerStorageConfig } from "../config/env.js";
import { createPrismaClient } from "../lib/prisma.js";
import { describeError } from "../lib/describe-error.js";
import { closeDueDeliveries } from "../modules/delivery/index.js";
import { purgeExpiredNotifications } from "../modules/notifications/index.js";
import { ShopOrderLifecycle, type JobResult } from "../modules/orders/index.js";
import { runProductImageCleanup, type ProductImageCleanupResult } from "../modules/products/index.js";
import { runLogoCleanup, S3ObjectStorage, type LogoCleanupResult } from "../modules/shops/index.js";
import {
  createAdvisoryLock,
  DELIVERY_AUTO_CLOSE_LOCK_NAME,
  LOGO_CLEANUP_LOCK_NAME,
  NOTIFICATION_RETENTION_LOCK_NAME,
  ORDER_EXPIRY_LOCK_NAME,
  ORDER_REMINDER_LOCK_NAME,
  PRODUCT_IMAGE_CLEANUP_LOCK_NAME,
} from "./advisory-lock.js";
import { purgeExpiredPhoneChanges } from "./phone-change-retention.js";
import { createRetentionSchedule, type RetentionSchedule } from "./retention-schedule.js";

/** Logo cleanup interval (spec 06, Cleanup and reconciliation). */
const LOGO_CLEANUP_INTERVAL_MS = 5 * 60_000;
/** Product image cleanup interval (spec 07), the same as the logo job. */
const PRODUCT_IMAGE_CLEANUP_INTERVAL_MS = 5 * 60_000;
/** Shop order expiry and reminder interval (spec 11, section 8). */
const ORDER_JOBS_INTERVAL_MS = 5 * 60_000;
/** Automatic closure of failed deliveries (spec 12, section 6). */
const DELIVERY_AUTO_CLOSE_INTERVAL_MS = 5 * 60_000;

dotenv.config({ quiet: true });
const databaseUrl = process.env["DATABASE_URL"];
if (databaseUrl === undefined || databaseUrl === "") {
  console.error("Invalid worker configuration:\n  - DATABASE_URL: is required");
  process.exit(1);
}

/** Host, port, and database name only: never the user or password. */
function describeDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

const prisma = createPrismaClient(databaseUrl);
const lock = createAdvisoryLock(databaseUrl, () => {
  console.error("Worker lock connection lost; exiting so the worker restarts and reacquires the lock");
  process.exit(1);
});

const schedule = createRetentionSchedule({
  purge: () => purgeExpiredPhoneChanges(prisma),
  lock,
  log: (line) => console.log(line),
  // Only the error type, code, and stack frames: messages can quote data.
  logError: (line, error) => console.error(`${line}: ${describeError(error)}`),
});

const { storage, logo } = loadWorkerStorageConfig(process.env);
let logoSchedule: RetentionSchedule | null = null;
let productImageSchedule: RetentionSchedule | null = null;
if (storage === undefined) {
  console.warn("Object storage (S3_*) is not configured: the shop logo and product image cleanup jobs are disabled");
} else {
  const objectStorage = new S3ObjectStorage(storage);
  const logoLock = createAdvisoryLock(
    databaseUrl,
    () => {
      console.error("Worker logo-cleanup lock connection lost; exiting so the worker restarts and reacquires the lock");
      process.exit(1);
    },
    LOGO_CLEANUP_LOCK_NAME,
  );
  logoSchedule = createRetentionSchedule<LogoCleanupResult>({
    name: "logo cleanup",
    lockName: "logo-cleanup",
    intervalMs: LOGO_CLEANUP_INTERVAL_MS,
    purge: () => runLogoCleanup({ prisma, storage: objectStorage, timing: logo, mediaPublicBaseUrl: storage.mediaPublicBaseUrl }),
    summarize: (r) =>
      `uploads expired ${r.expiredUploads}, leases reclaimed ${r.reclaimedToPending}/${r.reclaimedToExpired} (pending/expired), ` +
      `objects reclaimed ${r.reclaimedObjects}, objects deleted ${r.deletedObjects} (failed ${r.failedObjectDeletes}), ` +
      `staging deleted ${r.deletedStagingObjects} (failed ${r.failedStagingDeletes})`,
    lock: logoLock,
    log: (line) => console.log(line),
    logError: (line, error) => console.error(`${line}: ${describeError(error)}`),
  });
  const productImageLock = createAdvisoryLock(
    databaseUrl,
    () => {
      console.error("Worker product-image-cleanup lock connection lost; exiting so the worker restarts and reacquires the lock");
      process.exit(1);
    },
    PRODUCT_IMAGE_CLEANUP_LOCK_NAME,
  );
  productImageSchedule = createRetentionSchedule<ProductImageCleanupResult>({
    name: "product image cleanup",
    lockName: "product-image-cleanup",
    intervalMs: PRODUCT_IMAGE_CLEANUP_INTERVAL_MS,
    purge: () => runProductImageCleanup({ prisma, storage: objectStorage, timing: logo }),
    summarize: (r) =>
      `uploads expired ${r.expiredUploads}, leases reclaimed ${r.reclaimedToPending}/${r.reclaimedToExpired} (pending/expired), ` +
      `images reclaimed ${r.reclaimedImages}, images deleted ${r.deletedImages} (failed ${r.failedImageDeletes}), ` +
      `staging deleted ${r.deletedStagingObjects} (failed ${r.failedStagingDeletes})`,
    lock: productImageLock,
    log: (line) => console.log(line),
    logError: (line, error) => console.error(`${line}: ${describeError(error)}`),
  });
}

// Shop order expiry and reminders (spec 11, D7): bounded batches, one
// transaction per shop order, each job behind its own advisory lock.
const lifecycle = new ShopOrderLifecycle(prisma);
function orderJobSchedule(name: string, lockName: string, run: () => Promise<JobResult>, summarize: (r: JobResult) => string, intervalMs: number): RetentionSchedule {
  const jobLock = createAdvisoryLock(
    databaseUrl as string,
    () => {
      console.error(`Worker ${name} lock connection lost; exiting so the worker restarts and reacquires the lock`);
      process.exit(1);
    },
    lockName,
  );
  return createRetentionSchedule<JobResult>({
    name,
    lockName: name.replaceAll(" ", "-"),
    intervalMs,
    purge: run,
    summarize,
    lock: jobLock,
    log: (line) => console.log(line),
    logError: (line, error) => console.error(`${line}: ${describeError(error)}`),
  });
}
const shopOrders = (verb: string) => (r: JobResult) => `shop orders ${verb} ${r.done} (failed ${r.failed})`;
const expirySchedule = orderJobSchedule("shop order expiry", ORDER_EXPIRY_LOCK_NAME, () => lifecycle.expireDue(), shopOrders("expired"), ORDER_JOBS_INTERVAL_MS);
const reminderSchedule = orderJobSchedule("shop order reminder", ORDER_REMINDER_LOCK_NAME, () => lifecycle.remindDue(), shopOrders("reminded"), ORDER_JOBS_INTERVAL_MS);
// Failed deliveries left without a new attempt past their deadline (D5).
const deliveryAutoCloseSchedule = orderJobSchedule(
  "delivery auto close",
  DELIVERY_AUTO_CLOSE_LOCK_NAME,
  () => closeDueDeliveries(prisma),
  (r) => `deliveries closed ${r.done} (failed ${r.failed})`,
  DELIVERY_AUTO_CLOSE_INTERVAL_MS,
);

// Notification retention (spec 15, O6.3): bounded batches, its own lock. Only
// notifications are deleted; the event-key ledger is kept.
const notificationRetentionLock = createAdvisoryLock(
  databaseUrl,
  () => {
    console.error("Worker notification-retention lock connection lost; exiting so the worker restarts and reacquires the lock");
    process.exit(1);
  },
  NOTIFICATION_RETENTION_LOCK_NAME,
);
const notificationRetentionSchedule = createRetentionSchedule<number>({
  name: "notification retention",
  lockName: "notification-retention",
  purge: () => purgeExpiredNotifications(prisma),
  summarize: (deleted) => `deleted ${deleted} notification(s) older than 365 days`,
  lock: notificationRetentionLock,
  log: (line) => console.log(line),
  logError: (line, error) => console.error(`${line}: ${describeError(error)}`),
});

console.log(
  `Worker started (pid ${process.pid}); database ${describeDatabase(databaseUrl)}; retention every 24 h` +
    (logoSchedule === null ? "" : "; logo and product image cleanup every 5 min") +
    "; shop order expiry and reminders every 5 min; delivery auto close every 5 min; notification retention every 24 h",
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Worker received ${signal}; finishing the current run before exiting`);
  try {
    await Promise.all([schedule.stop(), logoSchedule?.stop(), productImageSchedule?.stop(), expirySchedule.stop(), reminderSchedule.stop(), deliveryAutoCloseSchedule.stop(), notificationRetentionSchedule.stop()]);
    await prisma.$disconnect();
    console.log("Worker stopped cleanly");
    process.exit(0);
  } catch (error) {
    console.error(`Worker shutdown failed: ${describeError(error)}`);
    process.exit(1);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await Promise.all([schedule.start(), logoSchedule?.start(), productImageSchedule?.start(), expirySchedule.start(), reminderSchedule.start(), deliveryAutoCloseSchedule.start(), notificationRetentionSchedule.start()]);
