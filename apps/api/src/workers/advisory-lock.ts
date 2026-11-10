import pg from "pg";

import type { WorkerLock } from "./retention-schedule.js";

/** Lock name; `hashtext` turns it into the advisory-lock key. */
export const RETENTION_LOCK_NAME = "chicman:phone-change-retention";
/** Lock of the shop logo cleanup job (spec 06). */
export const LOGO_CLEANUP_LOCK_NAME = "chicman:logo-cleanup";
/** Lock of the product image cleanup job (spec 07). */
export const PRODUCT_IMAGE_CLEANUP_LOCK_NAME = "chicman:product-image-cleanup";
/** Lock of the shop order expiry job (spec 11, D7). */
export const ORDER_EXPIRY_LOCK_NAME = "chicman:shop-order-expiry";
/** Lock of the seller response reminder job (spec 11, D7). */
export const ORDER_REMINDER_LOCK_NAME = "chicman:shop-order-reminder";
/** Lock of the automatic closure of failed deliveries (spec 12, D5). */
export const DELIVERY_AUTO_CLOSE_LOCK_NAME = "chicman:delivery-auto-close";

/**
 * A PostgreSQL session advisory lock on a dedicated connection. The lock is
 * held for the life of the connection, so it is released automatically if
 * the process dies. If the connection drops, the lock is lost: `onLost` is
 * called and the process should exit so it restarts and acquires it again.
 */
export function createAdvisoryLock(databaseUrl: string, onLost: () => void, lockName: string = RETENTION_LOCK_NAME): WorkerLock {
  const client = new pg.Client({ connectionString: databaseUrl });
  let connected: Promise<void> | null = null;
  let held = false;
  let released = false;

  client.on("error", () => {
    // The error message can quote connection details; only the fact is reported.
    if (!released) onLost();
  });
  client.on("end", () => {
    if (!released && held) onLost();
  });

  return {
    async tryAcquire() {
      if (held) return true;
      connected ??= client.connect().then(() => undefined);
      await connected;
      const result = await client.query<{ acquired: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        [lockName],
      );
      held = result.rows[0]?.acquired === true;
      return held;
    },
    async release() {
      released = true;
      if (connected === null) return;
      try {
        if (held) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]);
      } finally {
        held = false;
        await client.end().catch(() => undefined);
      }
    },
  };
}
