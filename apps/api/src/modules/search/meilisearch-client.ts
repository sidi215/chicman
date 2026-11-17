/**
 * A small Meilisearch HTTP client (spec 18): only the calls the product index
 * needs, with a timeout on every request. Errors carry a stable code (the
 * Meilisearch error code, `timeout`, `network`, or `http_<status>`) and never
 * the response body or the key, so they can be logged safely.
 */

export interface MeilisearchConfig {
  /** Base URL, without a trailing slash. */
  url: string;
  /** API search key for the API process, an admin key for the worker. */
  apiKey: string | undefined;
  /** Index UID of the product index. */
  indexUid: string;
  /** Timeout of one HTTP request. */
  timeoutMs: number;
}

export class SearchEngineError extends Error {
  override readonly name = "SearchEngineError";

  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(`search engine error: ${code}`);
  }
}

/** A stable, loggable code for any search failure. */
export function searchErrorCode(error: unknown): string {
  if (error instanceof SearchEngineError) return error.code;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "timeout";
  if (error instanceof TypeError) return "network";
  return "unknown";
}

/** Meilisearch codes are lower-case words joined by underscores; anything else is not echoed. */
const SAFE_CODE = /^[a-z0-9_]{1,64}$/;

interface TaskReference {
  taskUid: number;
}

interface Task {
  status: "enqueued" | "processing" | "succeeded" | "failed" | "canceled";
  error?: { code?: unknown } | null;
}

export interface SearchRequestBody {
  q: string;
  filter: string[];
  sort?: string[];
  page: number;
  hitsPerPage: number;
  matchingStrategy: "last" | "all";
}

export interface SearchResponse {
  ids: string[];
  totalHits: number;
}

export class MeilisearchClient {
  private readonly base: string;

  constructor(
    private readonly config: MeilisearchConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  ) {
    this.base = config.url.replace(/\/+$/, "");
  }

  private get indexPath(): string {
    return `/indexes/${encodeURIComponent(this.config.indexUid)}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        ...(this.config.apiKey === undefined ? {} : { authorization: `Bearer ${this.config.apiKey}` }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      let code = `http_${response.status}`;
      try {
        const parsed = JSON.parse(text) as { code?: unknown };
        if (typeof parsed.code === "string" && SAFE_CODE.test(parsed.code)) code = parsed.code;
      } catch {
        // Not JSON: keep the status code.
      }
      throw new SearchEngineError(code, response.status);
    }
    return (text === "" ? undefined : JSON.parse(text)) as T;
  }

  /** Waits until an asynchronous task has been applied; a failed task throws its code. */
  async waitForTask(reference: TaskReference, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let delay = 25;
    for (;;) {
      const task = await this.request<Task>("GET", `/tasks/${reference.taskUid}`);
      if (task.status === "succeeded") return;
      if (task.status === "failed" || task.status === "canceled") {
        const code = task.error?.code;
        throw new SearchEngineError(typeof code === "string" && SAFE_CODE.test(code) ? code : `task_${task.status}`);
      }
      if (Date.now() >= deadline) throw new SearchEngineError("task_timeout");
      await this.sleep(delay);
      delay = Math.min(delay * 2, 500);
    }
  }

  async search(body: SearchRequestBody): Promise<SearchResponse> {
    const result = await this.request<{ hits: { id: unknown }[]; totalHits?: unknown }>("POST", `${this.indexPath}/search`, {
      ...body,
      attributesToRetrieve: ["id"],
    });
    const ids = result.hits.map((hit) => hit.id).filter((id): id is string => typeof id === "string");
    return { ids, totalHits: typeof result.totalHits === "number" ? result.totalHits : ids.length };
  }

  /** Creates the index if it does not exist yet. */
  async createIndex(primaryKey: string): Promise<void> {
    try {
      await this.waitForTask(await this.request<TaskReference>("POST", "/indexes", { uid: this.config.indexUid, primaryKey }));
    } catch (error) {
      if (error instanceof SearchEngineError && error.code === "index_already_exists") return;
      throw error;
    }
  }

  async updateSettings(settings: object): Promise<void> {
    await this.waitForTask(await this.request<TaskReference>("PATCH", `${this.indexPath}/settings`, settings));
  }

  /** Adds or replaces whole documents. */
  async replaceDocuments(documents: readonly object[]): Promise<void> {
    await this.waitForTask(await this.request<TaskReference>("POST", `${this.indexPath}/documents`, documents));
  }

  async deleteDocuments(ids: readonly string[]): Promise<void> {
    await this.waitForTask(await this.request<TaskReference>("POST", `${this.indexPath}/documents/delete-batch`, ids));
  }

  /** One page of the IDs in the index; a missing index has none. */
  async documentIds(offset: number, limit: number): Promise<{ ids: string[]; total: number }> {
    try {
      const page = await this.request<{ results: { id: unknown }[]; total: number }>("POST", `${this.indexPath}/documents/fetch`, {
        fields: ["id"],
        offset,
        limit,
      });
      return { ids: page.results.map((doc) => doc.id).filter((id): id is string => typeof id === "string"), total: page.total };
    } catch (error) {
      if (error instanceof SearchEngineError && error.code === "index_not_found") return { ids: [], total: 0 };
      throw error;
    }
  }
}
