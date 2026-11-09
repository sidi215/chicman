# 18 — Search

## Goal

Provide a dedicated product search experience optimized for the Chicman catalog and Mauritanian customers, using Meilisearch for fast search while preserving PostgreSQL as the source of truth.

## Design & Architecture Decisions

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

## Verification Checklist

- [ ] Search returns relevant public products.
- [ ] French and Arabic queries are supported.
- [ ] Unpublished, archived, or otherwise ineligible products are excluded.
- [ ] Product creation and updates synchronize with the search index.
- [ ] Product archival or removal updates the index correctly.
- [ ] Indexing failures can be retried and reconciled.
- [ ] Search filters cannot bypass product visibility rules.
- [ ] Pagination and sorting are validated.
- [ ] Search service failure is handled safely.
- [ ] PostgreSQL remains the source of truth.
- [ ] Web and mobile search interfaces work in French and Arabic RTL.
- [ ] API, web, and mobile tests cover the supported workflows.