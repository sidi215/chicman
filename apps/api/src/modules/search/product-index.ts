import type { CatalogListQuery } from "@chicman/shared";

import { describeError } from "../../lib/describe-error.js";
import { MeilisearchClient, searchErrorCode } from "./meilisearch-client.js";
import { PRODUCT_INDEX_SETTINGS, SEARCH_SORT, searchFilter, withoutArabicArticles, type ProductSearchDocument } from "./search-document.js";

/** A validated catalog query with a search text. */
export type SearchQuery = CatalogListQuery & { q: string };

/** Ordered product IDs of one page, and the number of matches. */
export interface SearchHits {
  ids: string[];
  total: number;
}

/** The query side of the product index (API process). */
export interface ProductSearchEngine {
  search(query: SearchQuery): Promise<SearchHits>;
}

/** The write side of the product index (worker process). */
export interface ProductIndexWriter {
  /** Creates the index and applies its settings; `force` applies them again. */
  prepare(force?: boolean): Promise<void>;
  replace(documents: readonly ProductSearchDocument[]): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
  /** One page of the IDs in the index. */
  ids(offset: number, limit: number): Promise<{ ids: string[]; total: number }>;
}

/** The product index on Meilisearch. */
export class MeilisearchProductIndex implements ProductSearchEngine, ProductIndexWriter {
  private prepared: Promise<void> | null = null;

  constructor(private readonly client: MeilisearchClient) {}

  async search(query: SearchQuery): Promise<SearchHits> {
    const sort = SEARCH_SORT[query.sort];
    const result = await this.client.search({
      // Matches the stripped forms in the documents (`nameForms`, `descriptionForms`).
      q: withoutArabicArticles(query.q),
      filter: searchFilter(query),
      ...(sort === undefined ? {} : { sort }),
      page: query.page,
      hitsPerPage: query.pageSize,
      // With an explicit order, every word must match, so the order is not
      // filled with partial matches. Relevance may drop the last words.
      matchingStrategy: sort === undefined ? "last" : "all",
    });
    return { ids: result.ids, total: result.totalHits };
  }

  prepare(force = false): Promise<void> {
    if (force || this.prepared === null) {
      this.prepared = (async () => {
        await this.client.createIndex("id");
        await this.client.updateSettings(PRODUCT_INDEX_SETTINGS);
      })();
      // A failure is retried by the next call.
      this.prepared.catch(() => {
        this.prepared = null;
      });
    }
    return this.prepared;
  }

  replace(documents: readonly ProductSearchDocument[]): Promise<void> {
    return this.client.replaceDocuments(documents);
  }

  remove(ids: readonly string[]): Promise<void> {
    return this.client.deleteDocuments(ids);
  }

  ids(offset: number, limit: number): Promise<{ ids: string[]; total: number }> {
    return this.client.documentIds(offset, limit);
  }
}

export interface ProductSearchOptions {
  /** After a failure, PostgreSQL answers alone for this long, so an outage does not slow every search. */
  cooldownMs?: number;
  now?: () => number;
  /** Logs a degraded path; receives only safe text. */
  log?: (line: string) => void;
}

/**
 * Asks the search engine, and reports when it cannot: `null` means "answer
 * from PostgreSQL" (not configured, cooling down after a failure, or failed
 * now). PostgreSQL stays usable whatever happens to the index (spec 18).
 */
export class ProductSearch {
  private unavailableUntil = 0;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly log: (line: string) => void;

  constructor(
    private readonly engine: ProductSearchEngine | undefined,
    options: ProductSearchOptions = {},
  ) {
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(line));
  }

  async find(query: SearchQuery): Promise<SearchHits | null> {
    if (this.engine === undefined || this.now() < this.unavailableUntil) return null;
    try {
      return await this.engine.search(query);
    } catch (error) {
      this.unavailableUntil = this.now() + this.cooldownMs;
      // The code and the error type only: never the query text.
      this.log(
        `Search engine unavailable (${searchErrorCode(error)}); answering searches from PostgreSQL for ${this.cooldownMs / 1000} s: ${describeError(error).split("\n")[0]}`,
      );
      return null;
    }
  }
}
