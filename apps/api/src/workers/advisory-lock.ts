import pg from "pg";

import type { WorkerLock } from "./retention-schedule.js";

/** Lock name; `hashtext` turns it into the advisory-lock key. */
export const RETENTION_LOCK_NAME = "chicman:phone-change-retention";

/**
 * A PostgreSQL session advisory lock on a dedicated connection. The lock is
 * held for the life of the connection, so it is released automatically if
 * the process dies. If the connection drops, the lock is lost: `onLost` is
 * called and the process should exit so it restarts and acquires it again.
 */
export function createAdvisoryLock(databaseUrl: string, onLost: () => void): WorkerLock {
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
        [RETENTION_LOCK_NAME],
      );
      held = result.rows[0]?.acquired === true;
      return held;
    },
    async release() {
      released = true;
      if (connected === null) return;
      try {
        if (held) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [RETENTION_LOCK_NAME]);
      } finally {
        held = false;
        await client.end().catch(() => undefined);
      }
    },
  };
}
