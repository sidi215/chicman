# 18 — Search

## Goal

Provide a dedicated product search experience optimized for the Chicman catalog and Mauritanian customers, using Meilisearch for fast search while preserving PostgreSQL as the source of truth.

## Design & Architecture Decisions

- **Spec 19 (product moderation, approved 2026-11-20, implemented 2026-11-20):** the `Product` search trigger's column list gains `moderationStatus`, so every moderation transition queues the product; the indexer removes or re-adds it through `PUBLIC_PRODUCT_WHERE`. Search documents carry no moderation data. Details: `19-product-moderation.md`, section 7.

- PostgreSQL remains the authoritative source of product data.
- Meilisearch is a derived search index, not the source of truth.
- Product discovery endpoints and basic facets already belong to Spec 08. This feature must extend them without duplicating their existing responsibilities.
- Search must return only products that satisfy the existing public product visibility rules.
- Search must respect product publication, shop approval, availability, and other existing visibility constraints.
- Support French and Arabic product search.
- Search should handle common differences in casing, whitespace, and Arabic text where supported by the selected Meilisearch configuration.
- Search results must support relevant sorting and pagination.
- Search filters should reuse existing catalog facets and product attributes.
- Search must not reveal unpublished products, private shop data, internal identifiers, or administrative information.
- Index updates must follow product creation, editing, publication, archival, and other relevant catalog changes.
- Indexing should be asynchronous where appropriate, with retry and recovery behavior.
- PostgreSQL must remain usable as a fallback if the search service is unavailable, subject to the existing API design.
- Do not use Meilisearch as an authorization layer.
- Do not introduce personalized recommendations, AI search, visual search, or sponsored ranking in the MVP.

## Implementation Details

Inspect Spec 08, the existing Meilisearch configuration, product services, and Docker setup before making changes.

Likely areas:
- `apps/api/src/` — search module, indexing services, query validation, and product-event integration.
- Prisma schema and migrations — only if indexing or synchronization state requires persistence.
- `apps/web/src/` — search input, suggestions if supported, result pages, and filters.
- `apps/mobile/` — customer search interface and result pages.
- `packages/shared/` — search query and result contracts.
- Docker Compose — local Meilisearch service, if not already configured.
- `context/architecture.md`
- `context/progress-tracker.md`.

Requirements:
- Define a stable searchable product document containing only public fields.
- Index only eligible public products.
- Update or remove documents when products become unavailable or unpublished.
- Ensure indexing failures can be retried and reconciled.
- Validate search query length, filters, sorting, and pagination on the server.
- Prevent arbitrary client-controlled Meilisearch filters from bypassing visibility rules.
- Keep API response contracts consistent with Spec 08.
- Provide useful no-results, loading, and service-unavailable states.
- Use appropriate debouncing in web and mobile search interfaces.
- Do not create a second product catalog API or duplicate existing discovery facets.

## Decisions (O8, confirmed by the project owner, 2026-11-14)

- **Sold-out products (C8): kept indexed.** A published product at zero stock stays searchable and shows its unavailable state, as in the listings (spec 08). `availability=available` is honoured. A document is removed only when its product stops being public (`PUBLIC_PRODUCT_WHERE`: unpublished, archived, shop not approved, no active image).
- **Fallback (Q16): a PostgreSQL match.** When Meilisearch is unavailable, the same request is answered by PostgreSQL: every word must appear (ignoring case) in the name, brand, description, or shop name, with the same filters, sorts, and pagination; relevance falls back to newest. The response says so (`search.degraded = true`) and clients show a notice.
- **Free launch (QA-01, project owner, 2026-11-21): no Meilisearch in production.** With no free host offering a disk, `SEARCH_ENGINE=postgres` makes PostgreSQL the search engine: the fallback's word match answers every search and is **not** reported as degraded (no notice); the API refuses `MEILI_URL` with it, and the worker's indexing jobs are off (the queue keeps one row per changed product). Moving to Meilisearch later is configuration only: `SEARCH_ENGINE=meilisearch`, `MEILI_*`, then `search:reindex`. The hosting rule below applies when Meilisearch is used.
- **Production hosting: self-hosted Docker.** Meilisearch runs as a container on the API's VPS with a persistent volume, reachable only on the private network, `MEILI_ENV=production` and a master key of at least 16 bytes. The API uses a search-only key, the worker an admin key.

## Verification Checklist

- [x] Search returns relevant public products.
- [x] French and Arabic queries are supported.
- [x] Unpublished, archived, or otherwise ineligible products are excluded.
- [x] Product creation and updates synchronize with the search index.
- [x] Product archival or removal updates the index correctly.
- [x] Indexing failures can be retried and reconciled.
- [x] Search filters cannot bypass product visibility rules.
- [x] Pagination and sorting are validated.
- [x] Search service failure is handled safely.
- [x] PostgreSQL remains the source of truth.
- [x] Web and mobile search interfaces work in French and Arabic RTL. (Web checked in a browser against the development API, which was answering from the fallback; Flutter by widget tests only.)
- [x] API, web, and mobile tests cover the supported workflows.

## Implementation Notes (2026-11-14)

**Contract (`packages/shared/src/products/catalog.ts`).** No new route. `GET /products` gains `q` (normalized: NFKC, invisible marks removed, whitespace collapsed, trimmed; at most 100 characters; blank = no search) and the `relevance` sort (default with `q`, refused without it). `LISTING_SORTS` are the three spec 08 sorts. The response gains an optional `search: { degraded }`, present only for a search. `GET /products/facets` is unchanged.

**Query path (`modules/products/catalog.service.ts`, `modules/search/product-index.ts`).** Meilisearch only chooses and orders product IDs for the requested page (`attributesToRetrieve: ["id"]`). Each ID is re-read from PostgreSQL with `catalogWhere` (public visibility and every filter), and the cards come from PostgreSQL, so a stale document can never show a hidden product or an old price; a stale hit can make a page shorter until the worker catches up. The index filter is built only from parsed fields, with values quoted and escaped (`searchFilter`). `total` is Meilisearch's exact count (capped by `maxTotalHits` = 5000). After any engine failure, `ProductSearch` answers from PostgreSQL for 30 s (one log line with the error code, never the query).

**Document (`modules/search/search-document.ts`).** Public fields only: ID, name, description, brand, category, French and Arabic category words, shop name, price in hundredths (integer), publication time, availability, lower-cased variant keys (size, color, size+color pair; any stock and in stock). Only `id` is displayed. Arabic: Meilisearch folds alef forms, teh marbuta, diacritics, and tatweel; it does not strip the article, so the article and its attached forms (`ال`, `وال`, `بال`, `فال`, `كال`, `لل`) are removed into extra searchable fields (`nameForms`, `descriptionForms`) and from the query, so both sides meet on the bare word. Ranking: `sort` first (explicit orders are exact, with every word required), then the text rules.

**Synchronization (migration `20261114120000_search_index`).** Database triggers on `Product`, `ProductVariant`, `ProductImage`, and `Shop` (status or name) write `SearchIndexTask` rows in the transaction of the change, so every write path is covered (seller routes, checkout and order stock, shop decisions, scripts). The worker's **search indexing** job (every 10 s, lock `chicman:search-indexing`, the only writer of documents) reads batches of 200, re-reads them through `PUBLIC_PRODUCT_WHERE`, replaces or deletes the documents, waits for Meilisearch to apply them, and deletes each task only if its `version` is unchanged. A failed batch is retried after 10 s, doubled per attempt up to an hour, with its error code stored. **Search reconciliation** (at start and every 6 h, lock `chicman:search-reconciliation`) re-applies the index settings and queues every public product and every indexed document whose product is not public. `pnpm --filter @chicman/api search:reindex` does both now (`--status` shows the queue).

**Configuration.** `MEILI_URL`, `MEILI_API_KEY`, `MEILI_PRODUCTS_INDEX` (default `products`), `MEILI_TIMEOUT_MS` (default 1500). Required in production; without them, development searches use the fallback and the worker leaves changes queued. The Compose `worker` uses the `meilisearch` service.

**Clients.** Web: a search box in the storefront header (on `/products` it updates the URL 350 ms after typing stops, keeping filters; elsewhere it submits to `/products?q=`), relevance in the sort list only during a search, a search heading, a degraded notice, a no-results state with "clear search", and `noindex` for search pages (the canonical URL drops `q`). Flutter: a search field on the listing (350 ms debounce), a search action on the home, the same states, French and Arabic.

**Not done here.** Suggestions (autocomplete) are not built: the spec makes them optional. Facets are not narrowed by the search text.

**Tests.** API 710 (search: contract, document, filters, client errors, cooldown, triggers, retries, version check, reconciliation, re-check, fallback including `%`/`_`, real Meilisearch French/Arabic/filters/sorts/pagination with `TEST_MEILI_URL`, and an end-to-end run). Web 291. Flutter 270.