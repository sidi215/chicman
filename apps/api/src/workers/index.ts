// Background worker process (architecture.md, apps/api/src/workers/).
// Runs scheduled maintenance jobs outside the API request path.
// In development it runs as the `worker` service of
// infrastructure/docker/docker-compose.yml (restart: unless-stopped).
import dotenv from "dotenv";

import { createPrismaClient } from "../lib/prisma.js";
import { describeError } from "../lib/describe-error.js";
import { createAdvisoryLock } from "./advisory-lock.js";
import { purgeExpiredPhoneChanges } from "./phone-change-retention.js";
import { createRetentionSchedule } from "./retention-schedule.js";

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

console.log(`Worker started (pid ${process.pid}); database ${describeDatabase(databaseUrl)}; retention every 24 h`);

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`Worker received ${signal}; finishing the current run before exiting`);
  try {
    await schedule.stop();
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

await schedule.start();
