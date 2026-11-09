# 15 — Notifications

## Goal

Provide a consistent notification system that informs customers, sellers, and administrators about important events in their workflows, with clear separation between notification creation, delivery, and read state.

**Built so far (with spec 10, 2026-11-09):** the `eventKey`, `resourceType`, and `resourceId` columns with the `(userId, readAt, createdAt)` index, the generalized `recordNotification` helper (`modules/notifications/notifications.ts`), and `SHOP_ORDER_PLACED`. Not built: keys for the six shop decisions, the read API, the notification centers, and every other event.

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
- Administrator events: none in this release (unresolved, section 7).

### 6. Resource references

Each notification may carry a resource reference (`resourceType`: `SHOP` or `SHOP_ORDER`; `resourceId`). Opening it goes through the normal route for that resource, which checks ownership again. A reference never grants access.

### 7. Unresolved (O6)

These stay open in `business-decisions-features-10-18.md` and are not assumed:

- Whether administrators receive any notification.
- Whether seller-addressed notifications (shop decisions, new orders) appear in the Flutter app. The Flutter app is customer-focused (O1). Until decided, the mobile notification center lists **customer order notifications only**.
- How long notifications are kept.

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

- A notification center and an unread indicator in the storefront header, and in the seller and admin layouts.
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

- [ ] The six existing shop decisions still create exactly one notification each, now with an event key.
- [ ] Each supported business event in section 5 creates the correct notification, in the same transaction as its change.
- [ ] Notifications reach only the intended recipients.
- [ ] Duplicate events (retries, repeated worker runs) do not create duplicate notifications.
- [ ] Users can list their own notifications and unread count.
- [ ] Users can mark their own notifications as read, one or all, repeatedly without error.
- [ ] Users cannot access another user's notifications (`404`).
- [ ] Internal administrative reasons and notes never appear in notifications.
- [ ] A rolled-back business change leaves no notification.
- [ ] Delivery and read states are not confused; `deliveredAt` stays empty without a channel.
- [ ] No email, push, or SMS is sent, and no documentation or interface claims external delivery.
- [ ] Web and mobile notification interfaces support French and Arabic RTL.
- [ ] API, web, and mobile tests cover the supported workflows.
