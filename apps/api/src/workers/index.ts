// Background worker process (architecture.md, apps/api/src/workers/).
// Runs scheduled maintenance jobs outside the API request path:
// - phone-change history retention (spec 04), every 24 hours;
// - shop logo (spec 06) and product image (spec 07) cleanup and
//   reconciliation, each every 5 minutes, when object storage is configured.
// In development it runs as the `worker` service of
// infrastructure/docker/docker-compose.yml (restart: unless-stopped).
import dotenv from "dotenv";

import { loadWorkerStorageConfig } from "../config/env.js";
import { createPrismaClient } from "../lib/prisma.js";
import { describeError } from "../lib/describe-error.js";
import { runProductImageCleanup, type ProductImageCleanupResult } from "../modules/products/index.js";
import { runLogoCleanup, S3ObjectStorage, type LogoCleanupResult } from "../modules/shops/index.js";
import { createAdvisoryLock, LOGO_CLEANUP_LOCK_NAME, PRODUCT_IMAGE_CLEANUP_LOCK_NAME } from "./advisory-lock.js";
import { purgeExpiredPhoneChanges } from "./phone-change-retention.js";
import { createRetentionSchedule, type RetentionSchedule } from "./retention-schedule.js";

/** Logo cleanup interval (spec 06, Cleanup and reconciliation). */
const LOGO_CLEANUP_INTERVAL_MS = 5 * 60_000;
/** Product image cleanup interval (spec 07), the same as the logo job. */
const PRODUCT_IMAGE_CLEANUP_INTERVAL_MS = 5 * 60_000;

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

console.log(
  `Worker started (pid ${process.pid}); database ${describeDatabase(databaseUrl)}; retention every 24 h` +
    (logoSchedule === null ? "" : "; logo and product image cleanup every 5 min"),
);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Worker received ${signal}; finishing the current run before exiting`);
  try {
    await Promise.all([schedule.stop(), logoSchedule?.stop(), productImageSchedule?.stop()]);
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

await Promise.all([schedule.start(), logoSchedule?.start(), productImageSchedule?.start()]);
