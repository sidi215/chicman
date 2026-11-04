# Architecture Context

## Stack

| Layer | Technology | Role |
|---|---|---|
| Web Framework | Next.js + TypeScript | Customer storefront, seller dashboard, and admin dashboard |
| Web UI | Tailwind CSS + shadcn/ui | Web interface and reusable components |
| Mobile Framework | Flutter + Dart | Customer and seller mobile applications |
| Mobile UI | Flutter Material 3 (customized) | Native mobile interface following the shared design system |
| Backend | Node.js + Express + TypeScript | REST API and centralized marketplace business logic |
| Authentication | Supabase Auth | Customer and seller authentication, phone OTP verification, and session management |
| Authorization | Express middleware + PostgreSQL | Role-based and resource-level access control |
| Database | PostgreSQL | Primary source of truth for marketplace data |
| ORM | Prisma | Database access, schema management, and migrations |
| Object Storage | S3-compatible API — SeaweedFS (local), Cloudflare R2 (production) | Product images, shop images, and other uploaded media |
| Search Engine | Meilisearch | Product search, filtering, and indexing |
| Cache / Queue | Redis | Caching, background jobs, and asynchronous processing |
| Notifications | SMS provider + application notification service | OTP and customer/seller notifications |
| Maps | MapLibre + OpenStreetMap | GPS location visualization and delivery location selection |
| Package Management | pnpm Workspaces (root) | Shared TypeScript packages between web and backend; Flutter is managed independently with pub |
| Containerization | Docker | Consistent development and deployment environments |
| CI/CD | GitHub Actions | Automated testing and deployment |
| Infrastructure | VPS / Cloud Hosting + Cloudflare | Application hosting, DNS, CDN, and security |

## System Boundaries

- `apps/web/` — Next.js application responsible for the customer storefront, seller dashboard, and administrator dashboard.

- `apps/mobile/` — Flutter application responsible for mobile customer and seller experiences.

- `apps/api/` — Node.js + Express backend responsible for REST endpoints, request validation, authentication verification, authorization, and marketplace business logic.

- `apps/api/src/modules/auth/` — Authentication integration with Supabase Auth, OTP verification, session validation, and account-related operations.

- `apps/api/src/modules/users/` — Customer profiles, seller accounts, user roles, and account management.

- `apps/api/src/modules/shops/` — Shop registration, shop profiles, business information, and administrator approval.

- `apps/api/src/modules/products/` — Product catalog, categories, product variants, images, prices, and product availability.

- `apps/api/src/modules/inventory/` — Stock management, inventory updates, and product availability validation.

- `apps/api/src/modules/cart/` — Shopping cart operations, cart items, and guest-to-authenticated cart merging.

- `apps/api/src/modules/addresses/` — Customer delivery addresses, GPS coordinates, location confirmation, and address management.

- `apps/api/src/modules/orders/` — Customer orders, seller-specific orders, order lifecycle, acceptance, rejection, and cancellation.

- `apps/api/src/modules/delivery/` — Seller-managed delivery operations, delivery fees, delivery status, and failed delivery handling.

- `apps/api/src/modules/notifications/` — Notification creation, delivery, and notification history.

- `apps/api/src/modules/reviews/` — Product reviews and ratings.

- `apps/api/src/modules/favorites/` — Customer wishlists and favorite products.

- `apps/api/src/modules/admin/` — Administrative operations, seller approvals, marketplace monitoring, and platform management.

- `apps/api/src/workers/` — Background processing for notifications, search indexing, and asynchronous tasks.

- `packages/shared/` — Shared API contracts, validation schemas, enums, and common business definitions where compatible with both web and backend TypeScript applications.

- `packages/design-tokens/` — Shared design specifications for colors, typography, spacing, and border radii. Flutter maintains equivalent native theme definitions.

- `infrastructure/` — Docker configuration, deployment configuration, environment templates, and infrastructure-related resources.

## Storage Model

- **PostgreSQL**: Primary source of truth. Stores users' application profiles, shops, seller approvals, products, categories, variants, inventory, carts, addresses, orders, seller orders, delivery information, reviews, favorites, and notification records.

- **Supabase Auth**: Stores and manages authentication identities, phone verification, credentials, and authentication sessions. Application profiles and marketplace permissions remain managed by the backend.

- **S3-Compatible Object Storage**: Stores product images, shop logos, banners, and other uploaded media. PostgreSQL stores file references and metadata rather than binary image contents. Local development uses SeaweedFS (Docker Compose); production uses Cloudflare R2. The backend talks to both only through the S3-compatible API, so the provider is selected by configuration (endpoint, bucket, credentials), never by provider-specific code.

- **Redis**: Stores temporary cache data, session-related temporary data when needed, queue data, rate-limit counters, and background job state.

- **Meilisearch**: Stores searchable product indexes derived from PostgreSQL. It is a secondary search system, not the authoritative source for product information.

## Auth and Access Model

- Every customer and seller authenticates through Supabase Auth using a phone number and password.

- OTP verification is required during customer registration. Phone verification must be completed before an account becomes fully active.

- Supabase Auth issues access tokens that are sent to the Express API as Bearer tokens.

- Express middleware verifies access tokens and identifies the authenticated user before processing protected requests.

- Application roles and permissions are managed by the backend and PostgreSQL, not trusted directly from client-side role information.

- Supported application roles include:
  - `CUSTOMER`
  - `SELLER`
  - `ADMIN`

- A seller must have an approved shop before accessing seller operations.

- Customers can browse the product catalog without authentication, but must authenticate before placing orders.

- Each shop belongs to its registered seller account.

- Sellers can manage only their own shops, products, inventory, seller orders, and delivery operations.

- Customers can access only their own profiles, carts, addresses, orders, favorites, and other private resources.

- Administrators can manage marketplace-wide resources according to their administrative permissions.

- Every protected resource must be authorized on the backend. Hiding a button in the frontend is not an access-control mechanism.

## Invariants

1. **PostgreSQL is the source of truth.** Redis and Meilisearch must never become authoritative sources for marketplace business data.

2. **One shared backend serves both platforms.** Web and mobile applications must use the same REST API and business rules.

3. **Authentication and authorization are separate.** Supabase Auth verifies identity; the backend determines what that identity is allowed to do.

4. **Seller isolation is mandatory.** A seller must never access or modify another seller's private resources without explicit administrative authorization.

5. **Shop approval is mandatory.** Unapproved shops cannot publish products or process marketplace orders.

6. **Stock must be validated server-side.** A product cannot be ordered beyond its available stock.

7. **Multi-vendor checkout creates separate seller orders.** One customer checkout can produce multiple independently managed seller orders.

8. **Seller order decisions are independent.** Accepting or rejecting one seller order must not automatically cancel other seller orders.

9. **Money and order records must remain consistent.** Prices, delivery fees, and order totals must be validated and recorded at checkout. Use appropriate database transactions for critical order operations.

10. **Search indexing is asynchronous.** Changes to products in PostgreSQL must eventually be reflected in Meilisearch.

11. **Object storage is not a database.** Uploaded files are stored in object storage, while their references and ownership metadata are maintained in PostgreSQL.

12. **Background work must not block API requests.** Notifications, search indexing, and other asynchronous tasks must be processed through background workers.

13. **All API inputs must be validated.** Never trust client-submitted prices, roles, permissions, stock values, or order totals.

14. **Web and mobile must follow the same business rules.** Neither client may implement independent versions of critical marketplace logic.

15. **Localization is a first-class requirement.** French and Arabic must be supported, including correct RTL/LTR behavior and consistent MRU currency formatting.

16. **Payment model for the initial release is cash on delivery.** Sellers independently collect payment for their own orders.
