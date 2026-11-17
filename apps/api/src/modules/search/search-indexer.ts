import type { PrismaClient } from "../../lib/prisma.js";
import { PUBLIC_PRODUCT_WHERE } from "../products/product-visibility.js";
import { searchErrorCode } from "./meilisearch-client.js";
import type { ProductIndexWriter } from "./product-index.js";
import { SEARCH_DOCUMENT_SELECT, toSearchDocument } from "./search-document.js";

/** Products indexed per Meilisearch request. */
export const SEARCH_INDEX_BATCH_SIZE = 200;
/** Batches per run, so one run stays bounded; the next run continues. */
export const SEARCH_INDEX_MAX_BATCHES = 25;
/** Retry delay after a failed batch: 10 s, doubled per attempt, at most an hour. */
export const SEARCH_RETRY_BASE_SECONDS = 10;
export const SEARCH_RETRY_MAX_SECONDS = 3600;

export interface SearchIndexingResult {
  /** Documents added or replaced. */
  indexed: number;
  /** Documents removed (products no longer public, or gone). */
  removed: number;
  /** Queued products whose batch failed; they are retried later. */
  failed: number;
  /** The failure code of the last failed batch, if any. */
  errorCode: string | null;
}

export interface SearchIndexingOptions {
  prisma: PrismaClient;
  index: ProductIndexWriter;
  batchSize?: number;
  maxBatches?: number;
}

/**
 * Applies queued product changes to the index (spec 18). Each product is read
 * again from PostgreSQL through `PUBLIC_PRODUCT_WHERE`: a public product gets
 * its current document, anything else (draft, archived, shop not approved, no
 * active image, deleted) loses it. A task is deleted only if its `version` is
 * unchanged, so a change made during the batch is indexed by a later one. A
 * failed batch is retried with a growing delay and never blocks later tasks.
 */
export async function runSearchIndexing(options: SearchIndexingOptions): Promise<SearchIndexingResult> {
  const { prisma, index } = options;
  const batchSize = options.batchSize ?? SEARCH_INDEX_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? SEARCH_INDEX_MAX_BATCHES;
  const result: SearchIndexingResult = { indexed: 0, removed: 0, failed: 0, errorCode: null };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const tasks = await prisma.searchIndexTask.findMany({
      where: { nextAttemptAt: { lte: new Date() } },
      orderBy: [{ nextAttemptAt: "asc" }, { requestedAt: "asc" }],
      take: batchSize,
      select: { productId: true, version: true },
    });
    if (tasks.length === 0) break;
    const ids = tasks.map((task) => task.productId);

    const products = await prisma.product.findMany({
      where: { AND: [PUBLIC_PRODUCT_WHERE, { id: { in: ids } }] },
      select: SEARCH_DOCUMENT_SELECT,
    });
    const documents = products.map(toSearchDocument);
    const kept = new Set(documents.map((document) => document.id));
    const removed = ids.filter((id) => !kept.has(id));

    try {
      await index.prepare();
      if (documents.length > 0) await index.replace(documents);
      if (removed.length > 0) await index.remove(removed);
    } catch (error) {
      const code = searchErrorCode(error);
      await prisma.$executeRaw`
        UPDATE "SearchIndexTask"
        SET "attempts" = "attempts" + 1,
            "lastErrorCode" = ${code},
            "nextAttemptAt" = CURRENT_TIMESTAMP + make_interval(secs => LEAST(${SEARCH_RETRY_MAX_SECONDS}::int, ${SEARCH_RETRY_BASE_SECONDS}::int * power(2, LEAST("attempts", 12))))
        WHERE "productId" = ANY(${ids}::uuid[])`;
      result.failed += ids.length;
      result.errorCode = code;
      // The engine is probably down: stop here, the next run retries what is due.
      break;
    }

    await prisma.searchIndexTask.deleteMany({
      where: { OR: tasks.map((task) => ({ productId: task.productId, version: task.version })) },
    });
    result.indexed += documents.length;
    result.removed += removed.length;
  }
  return result;
}

export interface SearchReconciliationResult {
  /** Public products queued for a fresh document. */
  queuedPublic: number;
  /** Documents in the index whose product is not public: queued for removal. */
  queuedStale: number;
  /** Documents whose ID is not a product ID at all: removed directly. */
  removedForeign: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;

async function enqueue(prisma: PrismaClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$executeRaw`SELECT "search_index_request"(${[...ids]}::uuid[])`;
}

/**
 * Recovery (spec 18): re-applies the index settings, then queues every public
 * product and every indexed document whose product is not public. Indexing
 * itself stays in `runSearchIndexing`, the only writer of documents, so the
 * two never race. Run periodically by the worker and by `search:reindex`.
 */
export async function requestSearchReconciliation(options: { prisma: PrismaClient; index: ProductIndexWriter }): Promise<SearchReconciliationResult> {
  const { prisma, index } = options;
  await index.prepare(true);

  const publicIds = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.product.findMany({
      where: PUBLIC_PRODUCT_WHERE,
      select: { id: true },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    if (page.length === 0) break;
    const ids = page.map((product) => product.id);
    for (const id of ids) publicIds.add(id);
    await enqueue(prisma, ids);
    cursor = ids.at(-1);
  }

  let queuedStale = 0;
  const foreign: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await index.ids(offset, PAGE);
    const stale = page.ids.filter((id) => UUID.test(id) && !publicIds.has(id));
    foreign.push(...page.ids.filter((id) => !UUID.test(id)));
    await enqueue(prisma, stale);
    queuedStale += stale.length;
    if (page.ids.length < PAGE || offset + PAGE >= page.total) break;
  }
  // No product can have such an ID, so removing it cannot race with indexing.
  if (foreign.length > 0) await index.remove(foreign);
  return { queuedPublic: publicIds.size, queuedStale, removedForeign: foreign.length };
}
