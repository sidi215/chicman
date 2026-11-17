// Search index recovery (spec 18). The worker does this on its own (indexing
// every 10 s, reconciliation every 6 h); this script is for an operator who
// wants it now, for example after restoring Meilisearch from an empty volume.
//
//   pnpm --filter @chicman/api search:reindex            reconcile, then index everything queued
//   pnpm --filter @chicman/api search:reindex -- --status  show the queue only
//
// Uses DATABASE_URL and MEILI_* (apps/api/.env, or the environment). Use an
// admin key in MEILI_API_KEY: the API's search key cannot write the index.
import dotenv from "dotenv";

import { loadWorkerSearchConfig } from "../src/config/env.js";
import { createPrismaClient } from "../src/lib/prisma.js";
import { describeError } from "../src/lib/describe-error.js";
import { MeilisearchClient, MeilisearchProductIndex, requestSearchReconciliation, runSearchIndexing } from "../src/modules/search/index.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}
const prisma = createPrismaClient(databaseUrl);

async function status(): Promise<void> {
  const [queued, failing, codes] = await Promise.all([
    prisma.searchIndexTask.count(),
    prisma.searchIndexTask.count({ where: { attempts: { gt: 0 } } }),
    prisma.searchIndexTask.groupBy({ by: ["lastErrorCode"], where: { attempts: { gt: 0 } }, _count: true }),
  ]);
  console.log(`Queued products: ${queued} (with failed attempts: ${failing})`);
  for (const row of codes) console.log(`  ${row.lastErrorCode ?? "unknown"}: ${row._count}`);
}

try {
  if (process.argv.includes("--status")) {
    await status();
  } else {
    const config = loadWorkerSearchConfig(process.env);
    if (config === undefined) throw new Error("MEILI_URL is required");
    const index = new MeilisearchProductIndex(new MeilisearchClient({ ...config, timeoutMs: Math.max(config.timeoutMs, 10_000) }));
    const reconciled = await requestSearchReconciliation({ prisma, index });
    console.log(`Queued ${reconciled.queuedPublic} public product(s) and ${reconciled.queuedStale} stale document(s); removed ${reconciled.removedForeign} foreign document(s).`);
    // Everything is due now, including earlier failures waiting for a retry.
    await prisma.searchIndexTask.updateMany({ data: { nextAttemptAt: new Date() } });
    for (;;) {
      const run = await runSearchIndexing({ prisma, index });
      console.log(`Indexed ${run.indexed}, removed ${run.removed}${run.failed > 0 ? `, failed ${run.failed} (${run.errorCode})` : ""}.`);
      if (run.failed > 0) process.exitCode = 1;
      if (run.failed > 0 || run.indexed + run.removed === 0) break;
    }
    await status();
  }
} catch (error) {
  console.error(`Search reindex failed: ${describeError(error)}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
