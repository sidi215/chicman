# 15 — Notifications

## Goal

Provide a consistent notification system that informs customers, sellers, and administrators about important events in their workflows, with clear separation between notification creation, delivery, and read state.

**Status (2026-11-11):** implemented on the API, web, and mobile. The order and delivery events were built with specs 10–12; this feature added the keys for the six shop decisions, the read API, the delivery-channel interface, and the web and mobile notification centers. Details: Implementation Notes. O6 was resolved on 2026-11-11 (section 7), and its two follow-ups (no admin-area bell; the 365-day cleanup with an event-key ledger) were implemented the same day (O6 follow-up).

## Design & Architecture Decisions

### 1. What already exists (extend it; do not duplicate it)

- **Table:** `Notification` (`userId`, `type` `VARCHAR(64)`, `payload` JSON, `createdAt`, `deliveredAt`, `readAt`; `apps/api/prisma/schema.prisma`).
- **Write path:** `recordShopDecisionNotification` (`apps/api/src/modules/notifications/shop-notifications.ts`) records the six shop-decision notifications of spec 06 inside the decision transaction, with an allowlisted payload. Types are in `SHOP_NOTIFICATION_TYPES` (`packages/shared`).
- **Missing:** no read API, no client screen, no idempotency key, no delivery channel. There is **no outbox** (audit C7).

This feature generalizes the existing helper and table. It never creates a second notification table, module, or write path, and it never re-implements the six shop notifications.

### 2. Principles

- Notifications are generated from important business events, not arbitrary client requests.
- Notification recipients and content are determined server-side.
- The MVP must support in-app notifications.
- Keep notification creation separate from delivery mechanisms so additional channels can be added later.
- Do not assume SMS, email, or push delivery is available unless explicitly configured and implemented.
- Notifications must respect the user's role and ownership.
- Do not expose internal administrative reasons, private admin notes, audit metadata, or other protected information.
- For initial shop application rejection, the owner-facing rejection reason may be shown in the seller dashboard through `rejection.applicantReason`. Do not include it in notification content (spec 06; already implemented).
- Users can list their notifications, mark them read, and access relevant resources only when authorized.

### 3. Recording approach (replaces the "existing outbox" assumption)

- **The record is the event:** a notification row is written **inside the transaction of the business change that causes it** (as spec 06 already does). It exists exactly when that change commits, and never otherwise.
- **No separate queue:** no outbox table and no message queue are introduced.
- **Idempotency:** every new notification carries a unique `eventKey`, built as `<type>:<id of the record that makes the event unique>:<recipient user ID>`. Examples:
  - the shop order status event ID, for a decision;
  - the delivery attempt ID, for a dispatch or a failure;
  - the shop order ID, for the reminder.

  Recording is an insert that does nothing on a key conflict.
- **Retries cannot duplicate:** a retried business operation either commits a new transition (one new key) or changes nothing (spec 11, 12, and 13 operations are conditional and idempotent). The key also covers repeated worker runs, such as the reminder.
- **Existing rows:** the six shop decision types get keys from their decision record (status event or change request ID). Rows created before this feature keep `eventKey = NULL`, and the uniqueness applies only to non-null keys.

**What this guarantees, and what it does not (S2-3, confirmed 2026-11-09):**
- Transactional recording guarantees **in-app persistence only**: the notification row exists if and only if its business change committed, and the recipient can read it in the app.
- It does **not** send, or guarantee, any email, push, SMS, or other external delivery. External delivery is not implemented by this feature and must not be described as implemented. It stays out of scope until a separate requirement specifies it.
- That requirement would define its own channel, delivery job, retries, and `deliveredAt` handling, reading the persisted rows.

### 4. Creation, delivery, and read state are distinct

- `createdAt`: when the business change committed.
- `deliveredAt`: set only by an **external channel**, when one exists. No channel exists in this release, so it stays empty. In-app display is not "delivery".
- `readAt`: set when the recipient marks it read.

A notification being created does not mean it was delivered or read.

### 5. Event catalog

Events for the order chain are recorded by the feature that owns the change, through this feature's helper. Payloads carry codes, amounts, references, and names, never pre-written text. Clients render them in French or Arabic.

| Type | Recipient | Recorded by | Payload (allowlist) |
|---|---|---|---|
| Six shop decisions (existing) | Shop owner | Spec 06 | Unchanged |
| `SHOP_ORDER_PLACED` | Seller | Spec 10 | Order reference, shop order ID, items count, total, deadline |
| `SHOP_ORDER_CONFIRMED` | Customer | Spec 11 | Order reference, shop name |
| `SHOP_ORDER_REJECTED` | Customer | Spec 11 | Order reference, shop name, reason code |
| `SHOP_ORDER_CANCELLED` | The other party (customer, or seller); both for admin and suspension | Spec 11 | Order reference, shop name, who cancelled (customer, seller, Chicman), reason code (never the admin's internal reason) |
| `SHOP_ORDER_EXPIRED` | Customer and seller | Spec 11 job | Order reference, shop name |
| `SHOP_ORDER_RESPONSE_REMINDER` | Seller | Spec 11 job | Order reference, deadline |
| `DELIVERY_DISPATCHED` | Customer | Spec 12 | Order reference, shop name, attempt number |
| `DELIVERY_ATTEMPT_FAILED` | Customer | Spec 12 | Order reference, shop name, reason code |
| `DELIVERY_COMPLETED` | Customer | Spec 12 (covers "payment collected", D9) | Order reference, shop name, amount collected |
| `DELIVERY_CLOSED_UNDELIVERABLE` | Customer | Spec 12 (covers "payment failed", D9) | Order reference, shop name |

**Not recorded:**
- Account or profile security events: none is defined by the authentication requirements (spec 03), so none is recorded.
- Administrator events: none in this release (O6.1, section 7).

### 6. Resource references

Each notification may carry a resource reference (`resourceType`: `SHOP` or `SHOP_ORDER`; `resourceId`). Opening it goes through the normal route for that resource, which checks ownership again. A reference never grants access.

### 7. Recipients and retention (O6, resolved 2026-11-11)

Confirmed by the project owner (`business-decisions-features-10-18.md`, O6):

- **O6.1 — Administrators:** no separate administrator audience in the first release; no administrator-specific events or recipients. The admin area must not present an administrator's ordinary customer or seller notifications as administrator notifications. Customer and seller notifications are unchanged.
- **O6.2 — Seller notifications on mobile:** web only (O1). The Flutter app lists **customer order notifications only**, with no seller filter, tab, or screen. Sellers read theirs in the web seller notification center.
- **O6.3 — Retention:** a notification is kept **365 days after its creation**, then becomes eligible for deletion.
  - A **daily** cleanup job deletes eligible notifications in **bounded batches**, so no run holds a long transaction or loads the database heavily.
  - It deletes notification records only: never orders, deliveries, payments, or any other business record.
  - It is idempotent and safe to run more than once, or from two workers at once.
  - **Idempotency survives deletion:** an event already recorded must never be recorded again after its notification is deleted. Event keys are therefore kept apart from the notification rows (Implementation Notes, O6 follow-up). Uniqueness is never weakened.
- **Security events:** none is recorded (section 5; spec 03 defines none).
- **External delivery** stays out of scope (section 3): the channel interface remains an extension point only.

## Implementation Details

Inspect existing notification records and architecture before changing anything. Feature 06 already records some notification events transactionally; extend that functionality rather than creating a duplicate notification system.

### Phases

| Phase | Scope | When |
|---|---|---|
| **1** | Shared event and type contract; `eventKey` and resource columns; the generalized helper; keys for the six shop decisions; the read API; the web and mobile notification centers and unread indicators | Before the order chain |
| **2** | Each order, delivery, and payment event | Added by specs 10–13 in their own transactions, as they are built |

### Backend

- `apps/api/src/modules/notifications/`: the generalized recording helper (keeps `shopDecisionPayload`'s allowlist approach), listing, unread count, and mark-read operations.
- **Migration (additive):** `Notification.eventKey` (`VARCHAR(200)`, nullable; unique where not null), `resourceType`, `resourceId`. Index `(userId, readAt, createdAt)` for unread counts.
- **Routes** (guard `user`; the recipient is always the authenticated user; another user's notification → `404`):

| Route | Purpose |
|---|---|
| `GET /api/v1/customers/me/notifications?cursor=&limit=` | Newest first; cursor on `(createdAt, id)`; `limit` ≤ 50 |
| `GET /api/v1/customers/me/notifications/unread-count` | Unread count |
| `POST /api/v1/customers/me/notifications/:notificationId/read` | Idempotent |
| `POST /api/v1/customers/me/notifications/read-all` | Idempotent |

  The `/customers/me` prefix is used because every bootstrapped user, seller or administrator included, is a customer (spec 04).
- **Delivery abstraction:** an interface for future channels only. No provider is implemented. If no channel is configured, notifications remain in-app records, and that limitation is stated in the progress tracker.

### Web

- A notification center and an unread indicator in the storefront header and in the seller layout. The admin layout follows O6.1 (section 7).
- Client state follows the cart provider's account-change guard (`features/cart/cart-provider.tsx`).

### Mobile

- A customer notification center and an unread indicator, listing customer order notifications (section 7).
- The same account-change guard as `cart_providers.dart`.

### Other areas

- `packages/shared/` — notification contracts, types, payload types.
- `context/architecture.md`, `context/progress-tracker.md`.

### Requirements

- Define a stable notification event and type contract.
- Persist notifications with the correct recipient and resource reference.
- Provide paginated listing and unread count.
- Provide a safe mark-as-read operation.
- Prevent users from reading or modifying another user's notifications.
- Ensure event processing and notification creation are idempotent.
- Avoid exposing protected decision reasons or internal notes.
- If delivery channels are not yet configured, retain notifications as in-app records and clearly report the limitation.
- Do not implement a specific SMS, email, or push provider without a separate approved requirement.

## Verification Checklist

- [x] The six existing shop decisions still create exactly one notification each, now with an event key. (`shops.test.ts`: key from the status event or change request, `SHOP` resource, `deliveredAt` empty.)
- [x] Each supported business event in section 5 creates the correct notification, in the same transaction as its change. (Order and delivery events: `orders.test.ts`, `delivery.test.ts`; shop decisions: `shops.test.ts`.)
- [x] Notifications reach only the intended recipients. (Recipient tests in specs 06, 11, 12; `notifications.test.ts` checks audiences and resources per party.)
- [x] Duplicate events (retries, repeated worker runs) do not create duplicate notifications. (`notifications.test.ts`: repeated and concurrent recording; reminder and job reruns in `orders.test.ts`, `delivery.test.ts`.)
- [x] Users can list their own notifications and unread count.
- [x] Users can mark their own notifications as read, one or all, repeatedly without error.
- [x] Users cannot access another user's notifications (`404`).
- [x] Internal administrative reasons and notes never appear in notifications. (Checked in the stored rows and in the list responses.)
- [x] A rolled-back business change leaves no notification. (`notifications.test.ts`; failed decisions in `shops.test.ts`.)
- [x] Delivery and read states are not confused; `deliveredAt` stays empty without a channel. (`deliveredAt` is not in the API response; marking read never sets it.)
- [x] No email, push, or SMS is sent, and no documentation or interface claims external delivery. (No channel configured; web and mobile texts are tested for it.)
- [x] Web and mobile notification interfaces support French and Arabic RTL. (Both languages checked by tests and the mobile RTL layout by a widget test; web in a browser and Android manually verified by the project owner on 2026-11-11.)
- [x] API, web, and mobile tests cover the supported workflows. (API `notifications.test.ts` 15, web `notifications.test.ts` 12, Flutter `notifications_test.dart` 15.)

## Implementation Notes (2026-11-11)

### Decisions the spec left open

- **Mobile scope (section 7, O6.2):** the routes take an optional `audience=CUSTOMER` query parameter, which narrows the list, the unread count, and read-all to customer order notifications. The mobile app always sends it, so its list, its bell, and its "mark all read" never touch seller notifications (which a seller reads on the web). Filtering on the client would have broken pagination and the count. Without the parameter, every notification of the user is included (web).
- **Audience:** each item carries `audience` (`CUSTOMER` or `SELLER`). Types sent to one party only take it from the type; `SHOP_ORDER_CANCELLED` and `SHOP_ORDER_EXPIRED` take it from the shop order (the recipient placed the order → `CUSTOMER`). This is unambiguous because checkout refuses an order from one's own shop (`OWN_SHOP`, spec 10). No column was added.
- **Resource:** `{ type: "SHOP", id }` or `{ type: "SHOP_ORDER", id, orderId }`. `orderId` (the customer order page's ID) is given to the customer only; the seller opens the shop order by its own ID. Links: customer → `/account/orders/:orderId` (mobile: the order detail screen); seller → `/seller/orders/:shopOrderId`; shop → `/seller/shop`. Those routes check ownership again. Rows recorded before resource references existed list with `resource: null` and open nothing.
- **Response:** `NotificationList` = `items` (`id`, `type`, `payload` as recorded, `audience`, `resource`, `createdAt`, `readAt`) and `nextCursor` (opaque base64url of the last `(createdAt, id)`; `null` on the last page). `limit` defaults to 20, at most 50. The recipient, the event key, and `deliveredAt` are not returned. Unread count: `{ unread }`.
- **Errors and writes:** an unknown, malformed, or another user's notification ID is `404 NOTIFICATION_NOT_FOUND`; a malformed cursor or an unknown query parameter is `400 BAD_REQUEST`. Mark one read and read-all answer `204` and are idempotent: a notification keeps its first `readAt`. Both writes are rate-limited (`notification-write`: 300 per user, 600 per IP, 10 minutes).
- **Shop decisions (section 3):** `recordShopDecisionNotification` now goes through `recordNotification`, keyed by the shop status event (application approval or rejection, suspension, reinstatement) or the change request (change-request decisions), with a `SHOP` resource. The payload type moved to `packages/shared` (`ShopDecisionNotificationPayload`); its allowlist is unchanged.
- **Delivery abstraction:** `modules/notifications/notification-channel.ts` defines `NotificationChannel` and an empty `CONFIGURED_NOTIFICATION_CHANNELS`. Nothing reads it; no provider, job, or retry exists. **Limitation:** notifications are in-app records only (recorded in `progress-tracker.md`).
- **Retention (O6.3):** 365 days; implemented on 2026-11-11 (O6 follow-up below).
- **Administrators:** no administrator event is recorded (O6.1). The admin area has no bell and no notification center; an administrator reads their own customer and seller notifications in the storefront and the seller area (O6 follow-up below).

### Web

- `features/notifications/`: logic (paths, result handling, text rendering from codes, links, local read state), messages (French and Arabic), `NotificationsProvider` (the unread count, with the cart provider's account-change guard; read on sign-in, on each page change, and on window focus; no polling or push), `NotificationsLink` (bell with the cart badge's style; signed-in users only), `NotificationsPage` (newest first, "see more", mark one or all read; opening an item marks it read).
- Routes: `/notifications` (storefront, bell in the header) and `/seller/notifications`. A new `seller/layout.tsx` adds the provider and a top bar with the bell; the pages are unchanged. The admin area has none (O6.1).

### Mobile

- `features/notifications/` (domain, `notificationsProvider` with the cart's account-change guard, messages, `NotificationsAction`, `NotificationsScreen`). The bell is in the home app bar, hidden for guests; the count is read on sign-in, when the screen opens, after each change, and when the app returns to the foreground. Tapping a notification marks it read and opens the customer order.
- `ApiClient.classify` now decodes a `204 No Content` answer as `null` (before, an empty body was `INVALID_RESPONSE`); other statuses are unchanged.

## O6 follow-up (implemented 2026-11-11)

The decisions are in section 7. Scope: the admin area (O6.1) and retention (O6.3) only. Recipients, notification channels, and order retention (O5) are unchanged; O6.2 needed no behavior change.

### Findings that shaped it

- `Notification.eventKey` was the only duplicate guard: `recordNotification` inserted with `skipDuplicates`, and the reminder job (`remindDue`) selected shop orders with `NOT EXISTS` on that key. Deleting a notification would have deleted its key, so the event could have been recorded again.
- In practice no producer replays an event a year later (every key comes from a record created once by a conditional change; a reminder is only due while the shop order is `PENDING` before its deadline). The database guarantee is kept anyway.
- Nothing references `Notification` by foreign key, so deleting notifications touches no business table.

### What was built

- **Migration `20261111120000_notification_retention`:** table `NotificationEvent` (`eventKey VARCHAR(200)` primary key, `recordedAt`), with no payload and no foreign key, backfilled from every non-null `Notification.eventKey`; index `Notification(createdAt)`. `Notification.eventKey` keeps its unique index. Applied to the test database (backfill checked on seeded rows; no drift against the schema). **Not applied to the development database**, like the spec 14 migration.
- **Event-key ledger:** `recordNotification` inserts the key into `NotificationEvent` first (`ON CONFLICT DO NOTHING`) and writes the notification only when the key is new, in the caller's transaction. A concurrent transaction with the same key waits on the primary key, then records nothing. The reminder job's `NOT EXISTS` reads the ledger. Ledger rows are never deleted: about one small row per notification ever recorded, and no personal data beyond the recipient's user ID inside the key.
- **Cleanup (`modules/notifications/notification-retention.ts`):** `purgeExpiredNotifications` deletes `Notification` rows with `createdAt < now − 365 days` (365 × 24 hours), read or unread, with or without an event key, oldest first, in batches of 1000, at most 100 batches per run, each batch its own statement. Worker job `notification retention`: at start, then every 24 hours, under the advisory lock `chicman:notification-retention`. A backlog larger than one run is finished by later runs.
- **Admin area (O6.1):** `admin/layout.tsx` and the `/admin/notifications` route are removed. The storefront and seller bells and centers are unchanged.
- **Mobile (O6.2):** code comment only.

### Checks

- [x] A notification older than 365 days is deleted; one at the boundary or newer is kept; read and unread alike; rows without an event key too.
- [x] A repeated or concurrent cleanup run deletes nothing more and fails nothing.
- [x] Batches are bounded (a backlog larger than one run is finished by later runs).
- [x] Orders, shop orders, items, status events, stock movements, payments, payment events, deliveries, and products are unchanged by a cleanup.
- [x] After a notification is deleted, recording the same event again records nothing, and the reminder job does not remind again. (Both tests were checked to fail without the ledger.)
- [x] The migration backfills the ledger from existing keys (checked on the test database).
- [x] The admin area has no bell and no notification center; the storefront and seller bells are unchanged.
- [x] The mobile app still lists customer order notifications only (no behavior change).
- [x] The worker runs the job on start and schedules it every 24 hours (short run against the test database).
- [ ] Manual check: the admin pages in a browser without the bell. The Compose `worker` still needs a rebuild, and the development database the migration, before the job runs there.
