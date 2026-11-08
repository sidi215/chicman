# 06 — Shop Management

## Goal

Let any registered customer apply to become a seller by creating a shop, track and correct the application, and let administrators approve, reject, suspend, and reinstate shops. Only administrator approval grants seller authorization, and only approved shops can perform normal seller operations. Approved shops can keep their details up to date, with identity-defining changes re-reviewed by an administrator.

## Design & Architecture Decisions

- Adopt the authoritative `Shop.status` contract from `architecture.md` (Auth and Access Model).
- **One shop per user** in the initial release, enforced by the database: `Shop.ownerUserId` is `@unique`, so a user owns at most one shop, whatever application roles they hold (applicants own their shop before they hold `SELLER`).
- The shop is always **resolved from the authenticated user** on the server. Owner routes take no shop ID (`/api/v1/sellers/me/shop`), so a client-provided shop ID can never select a shop. The owner is always the authenticated user (`ownerUserId` is set from the server-side identity, never from the request).
- Roles and ownership come from PostgreSQL after token verification (`feature-specs/03-authentication.md`). Token claims and request data never grant access.
- **Default deny:** any shop or seller operation not listed below is denied.

### Seller eligibility and roles

- **Any authenticated, bootstrapped user may apply.** Every registered user goes through the normal customer bootstrap (spec 04) and has exactly one `User` and one `CustomerProfile`. No `SELLER` role is needed to create a shop or resubmit an application.
- **Users hold a set of roles.** A user can be both `CUSTOMER` and `SELLER` (see `architecture.md`, `UserRole`). Becoming a seller never removes `CUSTOMER`.
- **Submitting an application does not grant `SELLER`.** Only an administrator's initial approval (`PENDING` → `APPROVED`) grants it, in the same transaction as the approval.
- **`SELLER` role transitions** (the same rule as `architecture.md` and spec 03):
  - **Initial approval** (`PENDING` → `APPROVED`, including approval of a resubmitted application): grants `SELLER` if the owner does not already hold it (`INSERT … ON CONFLICT DO NOTHING` on `UserRole`), records the `APPLICATION_APPROVED` decision, and makes the shop eligible for normal seller operations.
  - **Suspension** (`APPROVED` → `SUSPENDED`): retains `SELLER`; the role is not revoked. Normal seller operations are blocked because the shop is no longer `APPROVED`.
  - **Reinstatement** (`SUSPENDED` → `APPROVED`): restores `APPROVED` and retains the existing `SELLER` role. It performs no role grant, is not treated as an initial approval, and is recorded as `REINSTATED`.
  - No role-revocation rule is defined. Rejection never grants `SELLER`.
- **Seller authorization checks both** the `SELLER` role and the authoritative `Shop.status = APPROVED`. The role alone is never enough: rejection and suspension block normal seller operations through the status check, whatever roles the user holds.
- Client-provided roles, statuses, or approval decisions are never accepted.

### Status lifecycle

| Status | Meaning | Normal seller operations |
|---|---|---|
| `PENDING` | Application submitted (on creation or resubmission), awaiting admin review | No |
| `APPROVED` | Approved by an administrator | **Yes** |
| `REJECTED` | Rejected by an administrator; the owner may correct it and resubmit | No |
| `SUSPENDED` | A previously approved shop suspended by an administrator | No |

There is no draft status. An application is submitted in exactly two ways:

- **Initial submission = shop creation.** Creating a shop submits the initial application: the shop is inserted directly with `status = PENDING` and is immediately available for administrator review. It requires no existing shop. On the contrary, the user must own none (`Shop.ownerUserId` is unique).
- **Resubmission** is allowed only from `REJECTED`, only by the shop owner, and produces `PENDING`. Resubmitting from any other status returns `409`.

| Transition | Actor | Decision type and reasons (see Decision reasons) |
|---|---|---|
| (create) → `PENDING` (initial submission) | Applicant: any bootstrapped user owning no shop | — |
| `PENDING` → `APPROVED` | Administrator | `APPLICATION_APPROVED`; internal reason required |
| `PENDING` → `REJECTED` | Administrator | `APPLICATION_REJECTED`; `applicantReason` required (10–500 characters). It is the only reason: the audit reason and the explanation shown to the owner. `internalReason` is not accepted |
| `REJECTED` → `PENDING` (resubmission after correction) | Shop owner | — |
| `APPROVED` → `SUSPENDED` | Administrator | `SUSPENDED`; internal reason required |
| `SUSPENDED` → `APPROVED` (reinstatement) | Administrator | `REINSTATED`; internal reason required |

- Any other transition is rejected with `409 Conflict`. Transitions are enforced server-side only. The owner can never approve, reject, suspend, or reinstate.
- **No self-administration.** An administrator cannot perform administrative decisions on a shop they own, even when their account has the ADMIN role. This covers application approval and rejection, suspension, reinstatement, and change-request approval and rejection, and reading the shop's administrative history (internal reasons and notes). The check runs inside the decision transaction, under the shop row lock, before any write; a refused attempt returns `403 SHOP_SELF_ADMINISTRATION_FORBIDDEN` and changes nothing (no status change, decision, audit record, role grant, notification, or change-request outcome). The administrator keeps full rights on shops owned by other users; the review list (no internal data) stays available.
- Transitions are conditional updates on the expected current status (`UPDATE … WHERE id = $1 AND status = $expected`). Concurrent actions (for example a resubmission or a pending edit racing an admin decision, or two admins deciding at once) therefore cannot both succeed. The losing request gets `409`.
- **Every status change runs in one transaction** that performs the insert or conditional update, writes the audit record, and (for initial approval only) grants `SELLER` if not already held. If any step fails, nothing is committed.
- Suspension retains `SELLER`; the status check blocks access. Reinstatement retains the role without a new grant and restores access only when the administrator's `SUSPENDED` → `APPROVED` transition commits.
- Editing an approved shop (below) never changes `Shop.status`.

### Decision reasons and internal notes

**Every administrative decision requires exactly one reason** (10–500 characters), entered once by the administrator. For an initial application rejection, that single reason is both the audit reason and the owner-facing rejection reason. For the other five decisions it is internal only.

| # | Administrative decision | Decision type | Reason field (request and storage) | Visible to owner |
|---|---|---|---|---|
| 1 | Initial application approval (`PENDING` → `APPROVED`) | `APPLICATION_APPROVED` | `internalReason`, **required**, 10–500 characters | No |
| 2 | Initial application rejection (`PENDING` → `REJECTED`) | `APPLICATION_REJECTED` | `applicantReason`, **required**, 10–500 characters; it is also the audit reason (`internalReason` is not accepted) | **Yes**, only as `rejection.applicantReason` |
| 3 | Shop suspension (`APPROVED` → `SUSPENDED`) | `SUSPENDED` | `internalReason`, **required**, 10–500 characters | No |
| 4 | Shop reinstatement (`SUSPENDED` → `APPROVED`) | `REINSTATED` | `internalReason`, **required**, 10–500 characters | No |
| 5 | Change-request approval (`shopName` / `city`) | `CHANGE_REQUEST_APPROVED` | `internalReason`, **required**, 10–500 characters | No |
| 6 | Change-request rejection (`shopName` / `city`) | `CHANGE_REQUEST_REJECTED` | `internalReason`, **required**, 10–500 characters | No |

Every decision may also carry an optional `internalNote` (1–1000 characters), visible to administrators only.

- **Server-side validation:** the admin decision schema for each decision accepts only the fields listed for it. A missing or out-of-bounds reason, an `internalReason` on an application rejection, or an `applicantReason` on any other decision is refused with `400`, and nothing changes (the shop or change request keeps its status).
- All texts are plain text, sanitized like the application fields (NFC, trimmed, no control characters), and always rendered escaped.
- **Audit:** each decision is retained with its decision type, actor, timestamp, its single reason (`applicantReason` for an application rejection, `internalReason` otherwise), and `internalNote`. Shop decisions go in `ShopStatusEvent`, and change-request decisions on the `ShopChangeRequest` row (see Audit).
- **Separate fields for separate visibility.** `applicantReason` is the only owner-visible text and exists only on initial application rejections, where it is the decision's only reason. `internalReason` and `internalNote` are internal. They are separate request fields, separate columns, and separate response fields; the visibility of a stored reason follows from its field, never from a shared column; no general-purpose `reason` field exists in any owner- or seller-facing response.
- **Decision type is not a status.** `Shop.status` keeps its four values. The decision type records *which administrative decision* produced the current state, so a reinstatement (`REINSTATED`) is distinguishable from an initial approval (`APPLICATION_APPROVED`) although both result in `APPROVED`. No shop status is added.

#### Owner-facing shop view

`GET /api/v1/sellers/me/shop` returns, as separate fields:

| Field | Content |
|---|---|
| `status` | Current `Shop.status` (`PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`). |
| `latestDecision` | `{ type, decidedAt }` of the latest shop decision: `APPLICATION_APPROVED`, `APPLICATION_REJECTED`, `SUSPENDED`, or `REINSTATED`. `null` before the first decision. Owner actions (creation, resubmission) are not decisions and do not change it. |
| `rejection` | `{ applicantReason, rejectedAt }` from the latest initial-application rejection, present **only while `status = REJECTED`**. |
| `changeRequest` | The latest change request: proposed values, `status` (`PENDING`, `APPROVED`, `REJECTED`), `submittedAt`, `decidedAt`. A rejected request is shown as rejected, with the approved values unchanged and no reason. |

- The seller dashboard (web and mobile) shows the rejection reason next to the correction and resubmission actions. The rejection reason is retained in the audit history after resubmission and in every later state; it is never overwritten.
- **No leaks:** owner- and seller-facing responses are built from explicit response schemas (allowlisted fields), never by serializing database rows. `internalReason`, `internalNote`, administrator identities, and other audit metadata are never returned by any owner- or seller-facing API, including shop details, status, change requests, and history.

### Owner notifications

Each of the six administrative decisions produces one notification to the shop owner, recorded when the decision commits and delivered through the existing notifications module and background workers (`architecture.md`; channels and delivery belong to that module, not to this spec).

| Decision | Notification states |
|---|---|
| Initial application approval | The application was approved; the shop is `APPROVED`. |
| Initial application rejection | The application was rejected; the shop is `REJECTED` and can be corrected and resubmitted. The owner is directed to the seller dashboard to see the reason. |
| Suspension | The shop was suspended; it is `SUSPENDED`. |
| Reinstatement | The shop was reinstated; it is `APPROVED` again. |
| Change-request approval | The `shopName`/`city` change was approved and is now public. |
| Change-request rejection | The `shopName`/`city` change was rejected; the approved values are unchanged. |

- **Allowed content:** the decision type, the shop name, the resulting status or change-request outcome, the affected field names, and the decision time.
- **Never included:** `internalReason`, `internalNote`, administrator identities, or other audit metadata.
- The application-rejection reason is **not** included in notifications: this notification specification does not authorize it. The owner reads it in the seller dashboard through the authorized `rejection.applicantReason` field.
- Notification content is built from an explicit allowlisted template payload, never from the decision record.

### Audit

- Every status change, administrative or by the owner, appends one `ShopStatusEvent`: `shopId`, `fromStatus` (null on creation), `toStatus`, `actorUserId`, `decisionType` (one of the four shop decision types; null for owner actions), `internalReason` (required for decisions other than application rejection; null for application rejections and owner actions), `applicantReason` (required for application rejection, its single reason; null otherwise), `internalNote` (nullable), `createdAt`.
- Every change to a shop's application fields, in any status, appends one `ShopFieldChangeEvent` per changed field: `shopId`, `field`, `oldValue`, `newValue`, `actorUserId`, `source` (`OWNER_UPDATE`, `CHANGE_REQUEST_APPROVED`, or `LOGO_UPLOAD`), `createdAt`. It is written in the same transaction as the change.
- Change-request decisions are recorded on the `ShopChangeRequest` row itself (decision type via its outcome, decider, time, internal reason, internal note), and the request row is never deleted.
- The audit log is append-only: the API has no route that updates or deletes it, and it is written only inside the transaction that makes the change. Administrators can read a shop's full history (status events, field changes, change requests) through `modules/admin/`.

### Application fields

Validated with a **strict** allowlist schema (shared in `packages/shared`). Unknown or protected fields cause `400` and nothing is written; they are rejected, not silently dropped. The database write is built only from the validated object, never from the request body.

| Field | Required | Rule | Editing once `APPROVED` |
|---|---|---|---|
| `shopName` | Yes | string, trimmed, 1–100 characters | **Admin re-review** (change request) |
| `description` | Yes | string, trimmed, 1–2000 characters; line breaks allowed | Immediate |
| `contactPhone` | Yes | phone number normalized to E.164 (`+` followed by 8–15 digits) | Immediate |
| `city` | Yes | string, trimmed, 1–100 characters | **Admin re-review** (change request) |
| `address` | Yes | string, trimmed, 1–300 characters | Immediate |
| `whatsappPhone` | No | phone number normalized to E.164; absent or `null` clears it | Immediate |
| `logoUrl` | No | **Set only by the verified logo upload flow** (below). Never accepted as a string from the client. `PATCH` accepts only `logoUrl: null`, which removes the logo. | Immediate (via upload) |

- **Sanitizing:** strings are Unicode-normalized (NFC) and trimmed; control characters are rejected (except line breaks in `description`). Values are stored as plain text and always rendered escaped; HTML is never interpreted.
- **Contact phones are business data.** `contactPhone` and `whatsappPhone` are separate from the customer's personal contact phone (`CustomerProfile.phone`, spec 04), are never copied to or from it, and changing one never affects the other. Neither phone is an authentication identity (authentication is by email; spec 03), and neither is verified in the initial release.
- **Protected, server-managed fields** are never accepted from the client: `id`, `ownerUserId` (`ownerId`), `status`, approval, rejection, suspension, and reinstatement metadata (actor, reasons, internal notes, time), `createdAt`, `updatedAt`, and any role.
- No identity-document requirement in the initial release.
- Create (`POST`, the initial submission) requires every required field and accepts no logo (a logo is uploaded once the shop exists). Updates (`PATCH`, rules 3, 4, and 8) accept any subset of the fields allowed in that status, but the stored result must still satisfy the required fields.

### Editing an approved shop

While the shop is `APPROVED`, its fields follow a **split policy**:

**Immediate fields** — `description`, `contactPhone`, `whatsappPhone`, `address`, `logoUrl`:
- Updated directly through `PATCH /api/v1/sellers/me/shop` (and the logo upload flow), with no admin re-review.
- Same validation and ownership checks as every other write. Each change is audited (`ShopFieldChangeEvent`, `source = OWNER_UPDATE` or `LOGO_UPLOAD`).
- On an `APPROVED` shop, `shopName` or `city` in a `PATCH` body → `400` (they go through a change request), and nothing is written.

**Re-review fields** — `shopName`, `city`:
- The owner submits proposed values through `POST /api/v1/sellers/me/shop/change-requests` (`{ shopName?, city? }`, at least one, same validation as the fields).
- The proposal is stored as a **`ShopChangeRequest`** row; `Shop.shopName` and `Shop.city` are **not** modified. Public and buyer-facing APIs read only the `Shop` columns, so the approved values stay visible until an administrator decides.
- At most **one open request per shop** (partial unique index on `shopId` where `status = PENDING`). Submitting while one is open → `409`. The MVP has no edit or withdrawal of an open request.
- The owner's shop view shows the current approved values and the open request's proposed values.
- **Admin approval** (`POST /api/v1/admin/shops/:shopId/change-requests/:requestId/approve`): in one transaction, conditional update of the request `PENDING` → `APPROVED` (with a **required** `internalReason` and optional `internalNote`), copy the proposed values into `Shop`, and write one `ShopFieldChangeEvent` per field (`source = CHANGE_REQUEST_APPROVED`).
- **Admin rejection** (`…/reject`): conditional update of the request `PENDING` → `REJECTED`. `Shop` keeps its approved values, and the decision (decider, time, **required** `internalReason`, optional `internalNote`) is recorded on the request. The owner sees that the proposed change was rejected, but not the reason.
- A racing second decision gets `409`. Submitting or deciding a change request never changes `Shop.status`.
- New change requests can be submitted only while the shop is `APPROVED`. An open request is not cancelled by a later suspension; an administrator may still decide it, and the decision does not affect the shop's status.

Shops in `PENDING` or `REJECTED` are not public yet: the owner edits all fields directly (rules 3 and 4), and the administrator reviews the whole application.

### Shop logo upload

Logos are uploaded **directly to object storage** with a presigned URL, through the existing S3-compatible storage (SeaweedFS locally, Cloudflare R2 in production; `architecture.md`). This is a shop-specific flow, not a general media service.

| Constraint | Value |
|---|---|
| Formats | JPEG, PNG, WebP. SVG and every other format are rejected. |
| Uploaded original | At most 15 MB (15,728,640 bytes) and 64 megapixels |
| Published logo | At most 2 MB (2,097,152 bytes) and 1024 × 1024 pixels. It is always the server's normalized image, never the uploaded file |
| Presigned URL lifetime | 5 minutes |

**Storage locations:**
- **Staging bucket (private)** receives uploads. It is never publicly readable, so unverified content is never served.
- **Media bucket (public)** holds only verified, normalized logos, served from the configured public media origin (`MEDIA_PUBLIC_BASE_URL`).
- Both are plain S3 buckets selected by configuration, so the flow works the same on SeaweedFS and R2. Presigned **PUT** is used (R2 does not support presigned POST policies). The staging bucket's CORS allows `PUT` from the configured web origins.

**State.** Two records track every object the flow creates:

- **`ShopLogoUpload`** (one per upload request), `status`:

  | Status | Meaning | Next |
  |---|---|---|
  | `PENDING` | Presigned URL issued; waiting for completion, or a previous completion attempt failed in a retryable way | `PROCESSING`, `EXPIRED` |
  | `PROCESSING` | A completion attempt holds the lease (`attempt`, `leaseExpiresAt`) | `COMPLETED`, `REJECTED`, `PENDING` (retryable failure, or an expired lease reclaimed before `completeBy`), `EXPIRED` (an expired lease reclaimed after `completeBy`) |
  | `COMPLETED` | Terminal. `Shop.logoUrl` was set to this upload's public object in a committed transaction | — |
  | `REJECTED` | Terminal. The staged file failed content verification (`rejectionCode`) | — |
  | `EXPIRED` | Terminal. Never completed within the completion window | — |

- **`ShopLogoObject`** (one per public object the server writes), `status`:

  | Status | Meaning |
  |---|---|
  | `PENDING` | Recorded *before* the object is written; not referenced by any shop yet |
  | `ACTIVE` | The object currently referenced by `Shop.logoUrl` (at most one per shop) |
  | `RELEASED` | Not referenced and due for deletion (failed attempt, replaced or removed logo, reclaimed orphan) |
  | `DELETED` | Deleted from the media bucket |

  Because the row is committed before the object is written, every public object the server creates can be found and reconciled, even if the API process crashes.

**Flow:**
1. **Request upload:** `POST /api/v1/sellers/me/shop/logo/uploads` with `{ contentType, contentLength }`. The owner is authorized (rule 9). `contentType` must be `image/jpeg`, `image/png`, or `image/webp`, and `contentLength` at most 15 MB; otherwise `400`. These declared values only restrict the upload; they are never proof of content. Requests are rate-limited per shop (Redis rate-limit counters).
2. **Server prepares the upload:** generates `uploadId` (UUID) and the staging key `shop-logos/{shopId}/{uploadId}` (the client never chooses a key), and stores a `ShopLogoUpload` row (`PENDING`, declared type and size, `expiresAt` = now + 5 minutes, `completeBy` = `expiresAt` + the completion window).
3. **Server returns** `{ uploadId, uploadUrl, method: "PUT", headers: { "Content-Type", "Content-Length" }, expiresAt }`. The presigned PUT is valid for 300 seconds, for that single staging key, with `Content-Type` and `Content-Length` as signed headers.
4. **Client uploads** the file directly to the staging bucket with that request.
5. **Complete** (idempotent): `POST /api/v1/sellers/me/shop/logo/uploads/:uploadId/complete`.
   1. **Ownership:** the upload is looked up by `uploadId` **and** the owner's shop; another shop's upload → `404`.
   2. **Claim:** a conditional update moves the upload to `PROCESSING`, increments `attempt`, and sets `leaseExpiresAt` (`… WHERE id = $1 AND shopId = $2 AND now() <= completeBy AND (status = 'PENDING' OR (status = 'PROCESSING' AND leaseExpiresAt < now()))`). Only one request can win the claim. If none is won, the current state decides the response:
      - `COMPLETED` → `200` with the recorded result (`logoUrl` of its public object). No object, audit event, or state change is created.
      - `PROCESSING` with a live lease → `409` (`LOGO_COMPLETION_IN_PROGRESS`); the client retries later.
      - `REJECTED` → `422` with the recorded `rejectionCode`.
      - `EXPIRED`, or past `completeBy` → `410` (`LOGO_UPLOAD_EXPIRED`); the owner starts a new upload.
   3. **Verify and normalize** the staged object on every attempt (nothing from an earlier attempt is reused):
      - the actual size (object metadata, and a read capped at 15 MB) is at most 15 MB;
      - the actual type is detected from the file signature (magic bytes: JPEG, PNG, or WebP) and matches the declared type; the client's MIME type and file name are never trusted;
      - the pixel count, read from the header before any pixel is decoded, is at most 64 megapixels;
      - the image decodes successfully;
      - it is turned upright from its EXIF orientation, reduced to at most 1024 × 1024 without enlarging, and re-encoded in the same format. This removes EXIF (GPS coordinates, device information), XMP, IPTC, ICC profiles, and any data appended to the file;
      - quality steps down only if needed to fit 2 MB; an image that still cannot fit is refused (`LOGO_TOO_LARGE`);
      - the result is checked again (format, dimensions, no metadata) before it can be published.

      A missing staged object (`LOGO_NOT_UPLOADED`) is retryable: the upload returns to `PENDING` and the response is `422`. Any other verification failure is terminal: `REJECTED` with its `rejectionCode` (`LOGO_TOO_LARGE`, `LOGO_UNSUPPORTED_TYPE`, `LOGO_TOO_LARGE_DIMENSIONS`, `LOGO_INVALID_IMAGE`), response `422`, and `logoUrl` is unchanged.
   4. **Record the public object:** commit a `ShopLogoObject` row (`PENDING`) with a new unique key `shop-logos/{shopId}/{uploadId}/{objectId}.{jpg|png|webp}` (`objectId` is a fresh UUID per attempt).
   5. **Write the public object:** upload the **normalized bytes held in memory** (never a server-side copy of the staging key, which the client could have replaced) to the media bucket at that key, with a server-set `Content-Type`. The object is immutable: the key is new, so nothing is overwritten, and it is never written again.
   6. **Commit, in one database transaction, in this order:**
      1. mark the upload `COMPLETED` with `resultObjectId` (`… WHERE id = $uploadId AND status = 'PROCESSING' AND attempt = $attempt`). The attempt number fences out a request whose lease expired. This runs first, so a fenced-out attempt stops before touching any logo state;
      2. mark the shop's previously `ACTIVE` object, if any, `RELEASED` (`… WHERE shopId = $shopId AND status = 'ACTIVE'`; zero rows is fine when the shop has no logo);
      3. mark the new `ShopLogoObject` `ACTIVE` (`… WHERE id = $objectId AND status = 'PENDING'`);
      4. set `Shop.logoUrl` to `MEDIA_PUBLIC_BASE_URL` plus the key;
      5. write the audit event (`ShopFieldChangeEvent`, `source = LOGO_UPLOAD`).

      The previous object is released **before** the new one is activated. The partial unique index `(shopId) WHERE status = 'ACTIVE'` is checked per statement and cannot be deferred, so activating first would violate it whenever the shop already has a logo.

      Steps 1 and 3 must each affect exactly one row, otherwise the transaction rolls back. The upload becomes `COMPLETED`, the old object `RELEASED`, and the new object `ACTIVE` only together, when this transaction commits. A failed replacement therefore leaves the previous logo `ACTIVE` and still referenced by `Shop.logoUrl`.
   7. **Respond** `200` with `{ logoUrl }`. Staging cleanup happens afterwards (below) and never affects the result.

**Failure handling and recovery:**

| Case | Handling |
|---|---|
| **A. Public object write fails** (error or timeout in step 5) | `Shop.logoUrl` is unchanged and the upload is not completed. The `ShopLogoObject` row is marked `RELEASED`; a timeout may have written the object, and deleting a missing key is harmless. The upload returns to `PENDING` with `lastErrorCode` (fenced, see Attempt fencing), and the response is `503` (`LOGO_STORAGE_UNAVAILABLE`). A retry uses a new `objectId`, so a new key. |
| **B. Object written, database transaction fails** (step 6, a database error, not a lost fence) | Nothing references the new object, because the transaction rolled back. The server attempts a compensating delete of that key. If the delete succeeds, the object row is marked `DELETED`; otherwise `RELEASED`. The upload returns to `PENDING` (fenced; retryable, new key on retry), and the response is `503`. The object is never overwritten. |
| **C. Compensating delete fails, or the process dies mid-attempt** | The `ShopLogoObject` row (`RELEASED`, or still `PENDING`) identifies the orphan by key, upload, attempt, and time. Reconciliation (below) deletes it later. A `PROCESSING` upload whose lease expired is claimable again by a retry, and the cleanup job reclaims it if no retry comes (see Cleanup and reconciliation). |
| **D. Stale attempt** (the attempt lost its lease, and a newer attempt or the cleanup job has taken over the upload) | Detected when a fenced write affects no row (step 6.1, or the fenced write of A, B, or a verification outcome). See Attempt fencing. |

**Attempt fencing.** Every write an attempt makes to its upload is conditional on `status = 'PROCESSING' AND attempt = $attempt`: completion (step 6.1), the return to `PENDING` (missing staged object, cases A and B), and `REJECTED` (failed verification). If such a write affects no row, the attempt is **stale**, and this is handled separately from a database failure:
- The upload row is not changed. A stale attempt never returns an upload to `PENDING`, never moves a `COMPLETED` upload, and never overwrites `lastErrorCode` or `rejectionCode` of a newer attempt.
- Nothing of the newer attempt is touched: not its `ShopLogoObject`, not `Shop.logoUrl`, and not the shop's `ACTIVE` object. Step 6 rolled back entirely, so the stale attempt released nothing.
- Only the stale attempt's own object is cleaned up. Its `ShopLogoObject` row (never `ACTIVE`, never referenced) moves to `RELEASED` with `… WHERE id = $objectId AND status = 'PENDING'`, and a compensating delete of its own key is attempted (`DELETED` on success). Otherwise reconciliation deletes it later.
- The response is the **current authoritative state**, re-read after the rollback with the same mapping as an unwon claim: `COMPLETED` → `200` with the recorded `logoUrl` (the newer attempt's result); `PROCESSING` → `409` (`LOGO_COMPLETION_IN_PROGRESS`); `REJECTED` → `422`; `EXPIRED` → `410`; `PENDING` → `409` (`LOGO_COMPLETION_IN_PROGRESS`, retry).
- A genuine database error (case B) is told apart from a lost fence by the outcome: the transaction raised an error, rather than a conditional update affecting zero rows. Its own return to `PENDING` is fenced too, so even a database failure cannot overwrite a newer attempt's success.

**Cleanup and reconciliation** (a periodic job in the existing `apps/api/src/workers/`; no new queue infrastructure). Every step is idempotent and safe to retry (deleting a missing key succeeds):

- **Orphaned public objects:**
  1. Reclaim: a conditional update moves `ShopLogoObject` rows still `PENDING` after the lease duration to `RELEASED`. A late completion transaction for such a row then fails its `status = 'PENDING'` condition and rolls back, so it can never activate a reclaimed object.
  2. Delete: for each `RELEASED` row, first verify that no shop references it (`Shop.logoUrl` does not equal its public URL; `ACTIVE` rows are never selected), then delete the object and mark the row `DELETED`. On failure, record `deleteAttempts` and `lastDeleteError` and retry on the next run.
  3. An object referenced by a shop is never deleted.
- **Replaced or removed logos:** completing a new logo, or `PATCH logoUrl: null`, marks the previous object `RELEASED` in the same transaction. Its deletion follows the orphan path above.
- **Staging objects:**
  - deleted after `COMPLETED` and after `REJECTED` (best effort inline, then retried by the job until `stagingDeletedAt` is set);
  - for uploads never completed, the job first moves them `PENDING` → `EXPIRED` with a conditional update (`… WHERE status = 'PENDING' AND completeBy < now()`), then deletes the staging object.
  - **Abandoned `PROCESSING` uploads** (the process crashed or stalled after its claim, and no retry came): the job reclaims an upload whose lease has expired, with a conditional update on the values it read (`… WHERE id = $id AND status = 'PROCESSING' AND attempt = $attempt AND leaseExpiresAt < now()`):
    - **before `completeBy`** → `PENDING` with `lastErrorCode = LEASE_EXPIRED`, retryable by the owner. Its staging object is kept, because the retry needs it.
    - **after `completeBy`** → `EXPIRED`, then its staging object is deleted.
    - The reclaimed attempt's `ShopLogoObject` row, if any, is still `PENDING` and is reclaimed by the orphan path above.
    - If the stale process later wakes up, every fenced write fails and it follows Attempt fencing (case D): it never resets the upload or touches a newer completion.
  - The job never touches an upload whose lease is still live. An upload's staging object is deleted only once the upload is terminal (`COMPLETED`, `REJECTED`, or `EXPIRED`), so no running completion can lose its input.
  - Staging objects are never referenced by `Shop.logoUrl`, which only holds media URLs. Deleting one can therefore never remove an active logo; media objects follow the orphan path, which never deletes an `ACTIVE` or referenced object.
  - A failed staging delete leaves `stagingDeletedAt` empty, and the next run retries it. A failed reclaim (no row affected) means another actor already moved the upload, and the job skips it.

**Rules:**
- `logoUrl` only ever holds the public media URL of a verified object recorded as `ACTIVE`. A presigned URL or a staging key is never stored in it.
- **No overwriting:** staging and public keys are server-generated and unique under the shop's own prefix. Each presigned URL covers one staging key only. Every completion attempt writes a new public key, and public objects are never rewritten. A user cannot write to another shop's objects.
- Cleanup and reconciliation never block a request.
- Timing parameters (configuration, with defaults): completion lease `LOGO_COMPLETION_LEASE_MS` (default 60000; it must exceed the worst-case verification and write time) and completion window `LOGO_COMPLETION_WINDOW_MS` (default 900000, counted after `expiresAt`).

### Authorization rules

`requireApprovedSeller` applies **only** to normal seller operations. Onboarding uses the rules below. Every rule is evaluated server-side on every request.

| # | Operation | Allowed when | Result |
|---|---|---|---|
| 1 | Create shop (initial application submission) | Authenticated, bootstrapped user who owns no shop. No existing shop and no `SELLER` role are needed. The unique constraint is the final guard: a second or concurrent creation returns `409`. | `201`, `PENDING` |
| 2 | Resubmit own rejected application | Authenticated owner (shop resolved from the user) **and** `status = REJECTED`. Any other status → `409`. | `PENDING` |
| 3 | Manage pending application (view, update all application fields) | Authenticated owner **and** `status = PENDING`. | Status unchanged |
| 4 | Manage rejected application (view including the rejection reason, correct all fields) | Authenticated owner **and** `status = REJECTED`. Resubmission is rule 2. | Status unchanged |
| 5 | View shop status | Authenticated owner, in any status (including `SUSPENDED`). | — |
| 6 | Normal seller operations (products, inventory, seller orders, delivery) | Role `SELLER` **and** owner of the target shop **and** `Shop.status = APPROVED` (`requireApprovedSeller`). Resources referenced by ID (for example a product) must belong to the owner's shop. | — |
| 7 | Approve, reject, suspend, reinstate; decide change requests; read the audit history and internal notes | Authorized administrator only (role `ADMIN` from PostgreSQL), through `modules/admin/`, **and not the shop's owner** (`403 SHOP_SELF_ADMINISTRATION_FORBIDDEN`). | See lifecycle |
| 8 | Edit an approved shop (immediate fields; submit a `shopName`/`city` change request) | Role `SELLER` **and** owner **and** `status = APPROVED` (`requireApprovedSeller`). | Status unchanged |
| 9 | Upload or remove the shop logo | Authenticated owner **and** `status` is `PENDING`, `REJECTED`, or `APPROVED` (for `APPROVED`, `requireApprovedSeller`). | Status unchanged |

- A user never reaches another user's shop: there is no owner route with a shop ID, and resource IDs (uploads, change requests, products…) are checked against the owner's shop. Responses for resources the user does not own are `404`, so other shops' resources are not disclosed.
- A `PENDING` or `REJECTED` applicant, and a `SUSPENDED` shop, get `403` for all normal seller operations. A `SUSPENDED` shop keeps only rule 5: it cannot edit fields, submit change requests, or upload a logo.
- A user without a shop gets `404` from rules 2–5, 8, and 9.

## Implementation Details

**Backend:**
- `apps/api/src/modules/shops/`: owner shop routes (`POST /api/v1/sellers/me/shop` creates the shop and submits the initial application; `GET`, `PATCH /api/v1/sellers/me/shop`; `POST /api/v1/sellers/me/shop/resubmit`; `POST /api/v1/sellers/me/shop/change-requests`; `POST /api/v1/sellers/me/shop/logo/uploads` and `…/uploads/:uploadId/complete`), application validation, logo verification, the status lifecycle, and the authorization rules above.
- `apps/api/src/modules/admin/`: `POST /api/v1/admin/shops/:shopId/{approve,reject,suspend,reinstate}` (body: exactly one reason, `applicantReason` for `reject` and `internalReason` for `approve`, `suspend`, and `reinstate`; optional `internalNote`), `POST /api/v1/admin/shops/:shopId/change-requests/:requestId/{approve,reject}` (body: required `internalReason`, optional `internalNote`), and the shop list and full history for review.
- `apps/api/src/middleware/`: the onboarding guards (owner and status checks). `requireApprovedSeller` already exists (feature 03, guard `approvedSeller`).
- **Existing schema:** feature 03 created a minimal `Shop` model (`id`, `ownerUserId` unique, `status` default `PENDING`, timestamps) for seller authorization. This feature extends it with the application fields, audit records, change requests, and logo state in a new migration.
- `apps/api/src/workers/`: the logo cleanup and reconciliation job (expired uploads, staging objects, released and orphaned public objects).
- `apps/api/src/modules/notifications/`: owner notifications for the six decisions (allowlisted payload, see Owner notifications).
- `packages/shared`: the shop application, change-request, logo-upload, and admin decision schemas, and the owner-facing response schema (which has no `internalReason` or `internalNote` field).
- Configuration (`apps/api/src/config/`, validated at startup): S3 endpoint and credentials, `S3_UPLOADS_BUCKET` (private staging), `S3_MEDIA_BUCKET` (public), `MEDIA_PUBLIC_BASE_URL`, `LOGO_COMPLETION_LEASE_MS`, `LOGO_COMPLETION_WINDOW_MS`.
- The image decoding library used for verification is chosen at implementation time (a maintained library; its decoding limits must be configured so that oversized or malformed images cannot exhaust memory).

**Database:**
- `Shop`: `id`, `ownerUserId` (`@unique`, foreign key to `User`), `status` (enum `ShopStatus { PENDING APPROVED REJECTED SUSPENDED }`, default `PENDING`), `shopName`, `description`, `contactPhone`, `city`, `address`, `whatsappPhone?`, `logoUrl?`, `createdAt`, `updatedAt`.
- `ShopStatusEvent`: `id`, `shopId` (foreign key), `fromStatus?`, `toStatus`, `actorUserId` (foreign key to `User`), `decisionType?` (enum `ShopDecisionType { APPLICATION_APPROVED APPLICATION_REJECTED SUSPENDED REINSTATED }`), `internalReason?`, `applicantReason?`, `internalNote?`, `createdAt`; index on `(shopId, createdAt)`.
- `ShopChangeRequest`: `id`, `shopId` (foreign key), `proposedShopName?`, `proposedCity?` (at least one set), `status` (enum `ShopChangeRequestStatus { PENDING APPROVED REJECTED }`), `submittedByUserId`, `submittedAt`, `decidedByUserId?`, `decidedAt?`, `internalReason?` (required when decided), `internalNote?`. Partial unique index `(shopId) WHERE status = 'PENDING'` (raw SQL in the migration, since Prisma has no partial unique indexes).
- `ShopFieldChangeEvent`: `id`, `shopId` (foreign key), `field`, `oldValue?`, `newValue?`, `actorUserId`, `source` (enum `OWNER_UPDATE | CHANGE_REQUEST_APPROVED | LOGO_UPLOAD`), `createdAt`; index on `(shopId, createdAt)`.
- `ShopLogoUpload`: `id` (the `uploadId`), `shopId` (foreign key), `stagingKey`, `declaredContentType`, `declaredSize`, `status` (enum `PENDING | PROCESSING | COMPLETED | REJECTED | EXPIRED`), `attempt` (integer, default 0), `leaseExpiresAt?`, `expiresAt`, `completeBy`, `rejectionCode?`, `lastErrorCode?`, `resultObjectId?` (foreign key to `ShopLogoObject`), `completedAt?`, `stagingDeletedAt?`, `createdAt`, `updatedAt`.
- `ShopLogoObject`: `id` (the `objectId`), `shopId` (foreign key), `uploadId` (foreign key), `attempt`, `objectKey` (`@unique`), `status` (enum `PENDING | ACTIVE | RELEASED | DELETED`), `deleteAttempts` (default 0), `lastDeleteError?`, `createdAt`, `releasedAt?`, `deletedAt?`. Partial unique index `(shopId) WHERE status = 'ACTIVE'` (at most one active logo per shop; raw SQL in the migration).
- `UserRole` (`architecture.md`): initial approval adds `(ownerUserId, SELLER)` if absent; suspension and reinstatement do not change roles.

**Web:**
- `apps/web/src/features/shop/`: shop application, application status with the rejection reason, decision outcomes (approved, suspended, reinstated, change-request outcomes), correction and resubmission, approved-shop editing (immediate fields, change requests with pending values and outcomes), and logo upload.
- `apps/web/src/features/admin/`: shop review, decisions (the application rejection form asks for the applicant-facing `applicantReason` only; the other decisions ask for `internalReason`; every decision may add an `internalNote`), suspension and reinstatement, change-request review, history.

**Mobile:**
- `apps/mobile/lib/features/shop/`: shop application, application status with the rejection reason, approved-shop editing, and logo upload.

**Do not touch:**
- Product, inventory, order, and delivery features. They only consume `requireApprovedSeller`.
- Authentication provider configuration.
- Customer profile fields.

## Implementation Notes

Implemented on 2026-11-07. Automated checks: API `test/shops.test.ts`, `test/shop-logo.test.ts`, `test/shop-logo-s3.test.ts` (PostgreSQL, Redis, SeaweedFS), web `src/features/shop/shop.test.ts`, mobile `test/features/shop/`.

Decisions made during implementation (the spec left them open):

- **Image library:** `sharp` 0.35.5. Normalization (`modules/media/image-normalizer.ts`, shared with product images; `logo/logo-normalizer.ts` holds the logo limits and error codes) reads the header first (dimensions, format), then decodes with `limitInputPixels` = 64 megapixels; `sharp.cache(false)` and `concurrency(1)`. Two originals are processed at once per API process, across logos and product images, to bound memory. The normalized image is published, never the uploaded file. *(This replaces the earlier rule that published the verified original bytes and refused images over 1024 × 1024.)*
- **S3 client:** `@aws-sdk/client-s3` 3.1153.0 with path-style addressing and `requestChecksumCalculation: "WHEN_REQUIRED"` (no flexible-checksum headers in presigned URLs). The presigned PUT signs `content-length;content-type;host`.
- **Cloudflare R2 (verified 2026-11-08 against real buckets):** no code change was needed. Required configuration: a private staging bucket and a separate media bucket with public access enabled in the dashboard (`r2.dev` or a custom domain; `MEDIA_PUBLIC_BASE_URL` = that origin, with no bucket in the path); an API token with Object Read & Write on both buckets; endpoint `https://<account-id>.r2.cloudflarestorage.com` (no bucket in the path), region `auto`; a staging-bucket CORS rule allowing `PUT` with the `content-type` header from each web origin (required: the browser PUT is cross-origin); and the web's `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` / `NEXT_PUBLIC_MEDIA_BASE_URL` set to the R2 endpoint and the public origin (the development CSP fallback only covers local SeaweedFS). Never run `storage:setup --public-acl` against R2 (no ACLs).
- **Bucket setup:** `pnpm --filter @chicman/api storage:setup [-- --public-acl]` creates the buckets and the staging CORS rule. SeaweedFS makes the media bucket public with the `public-read` ACL (it refused the bucket-policy forms tried). R2 has no ACLs: public access is enabled in the R2 dashboard (custom domain or `r2.dev`), and `MEDIA_PUBLIC_BASE_URL` points to it.
- **Storage configuration:** the `S3_*` settings are all-or-nothing and required in production. Outside production, without them, the logo routes return `503 LOGO_STORAGE_NOT_CONFIGURED` and the worker skips the cleanup job.
- **Rate limit:** logo upload requests are limited to 10 per shop per 10 minutes (Redis counters, in-memory fallback).
- **Cleanup interval:** the logo cleanup job runs every 5 minutes in the existing worker, behind its own PostgreSQL advisory lock (`chicman:logo-cleanup`).
- **Notifications:** no notifications module existed. `modules/notifications/` now records a `Notification` row (recipient, type, allowlisted JSON payload: `shopName`, `shopStatus`, `changeRequestOutcome`, `fields`, `decidedAt`) inside the decision transaction. Delivery channels and a notification read API are not built; they belong to the notifications feature.
- **Owner view:** responses include the shop fields plus `status`, `latestDecision`, `rejection`, and `changeRequest` (with its `id`), built field by field. Mutations (`POST`, `PATCH`, resubmit, change request) return the same owner view.
- **Administrators:** no route grants `ADMIN`; operators use `pnpm --filter @chicman/api admin:grant -- --supabase-user-id <uuid>` (idempotent; `--revoke`, `--list`) on an existing, bootstrapped account.
- **Admin read routes:** `GET /api/v1/admin/shops` (query `status`, `openChangeRequest=true|false` (with or without a pending change request; absent: no filter), `limit` ≤ 100; oldest update first) and `GET /api/v1/admin/shops/:shopId` (shop, status events, field changes, change requests, with internal reasons, notes, and actor IDs).
- **Decision responses:** shop decisions return `{ shopId, status, decisionType, decidedAt }`; change-request decisions `{ id, shopId, status, decidedAt }`.
- **Error codes:** `SHOP_ERROR_CODES` in `packages/shared` (`SHOP_ALREADY_EXISTS`, `SHOP_NOT_FOUND`, `SHOP_STATUS_CONFLICT`, `REVIEW_FIELD_NOT_EDITABLE`, `CHANGE_REQUEST_OPEN`, `CHANGE_REQUEST_NOT_FOUND`, `CHANGE_REQUEST_CONFLICT`, `LOGO_*`). Validation failures are `400 BAD_REQUEST`.
- **Logo removal and creation audit:** `PATCH { logoUrl: null }` releases the `ACTIVE` object in the same transaction and is audited as `OWNER_UPDATE`. Shop creation writes its `ShopStatusEvent` (`null` → `PENDING`) but no field-change events (nothing changed yet).
- **Shop suspended during a logo completion:** the commit transaction re-checks the status under a row lock; if the shop may no longer change its logo, the attempt's object is released and deleted, the upload returns to `PENDING`, and the response is `403`.
- **A completion whose new object was reclaimed by the job** (rollback at step 6.3) releases and deletes its object, returns the upload to `PENDING` with `LEASE_EXPIRED` (fenced), and answers with the current state (`409`, retry).
- **Web CSP** (`apps/web/src/lib/csp.ts`, tested in `csp.test.ts`): the storage endpoint goes in `connect-src` (presigned PUT) and the media origin in `img-src` (logo display), from `NEXT_PUBLIC_STORAGE_UPLOAD_ORIGIN` and `NEXT_PUBLIC_MEDIA_BASE_URL`. In development only, when they are unset, both fall back to the local SeaweedFS origin `http://localhost:8333`. A production build has no fallback and allows only the configured origins.
- **Mobile:** `image_picker` ^1.2.4 picks the logo (iOS `NSPhotoLibraryUsageDescription` added); the client checks the file signature and the 15 MB upload size before uploading, and the server verifies and normalizes. Presigned uploads have a 5-minute timeout, because a 15 MB photo can be slow on a mobile connection.

## Verification Checklist

Creation and submission:
- [x] A customer without `SELLER` and without a shop can create a shop with valid fields; it is created directly as `PENDING` (`201`), and the initial application appears in the admin review list.
- [x] No draft status exists: `ShopStatus` has exactly `PENDING`, `APPROVED`, `REJECTED`, `SUSPENDED`.
- [x] Each missing required field, or an invalid value (length, phone format, a `logoUrl` string, control characters) → `400`, nothing is written.
- [x] The database rejects a second shop for the same owner, and concurrent creation attempts produce exactly one shop (`409` for the other).
- [x] Protected fields (`id`, `ownerUserId`/`ownerId`, `status`, roles, decision metadata, timestamps), alone or mixed with valid fields, on create or update → `400`, nothing is written.
- [x] The shop owner is always the authenticated user, even when the body names another user.
- [x] Updating the shop contact phone does not change the customer profile phone, and vice versa.
- [x] Resubmission from `REJECTED` → `PENDING`. Resubmission from `PENDING`, `APPROVED`, or `SUSPENDED` → `409`, status unchanged.
- [x] Only the owner can resubmit: another user (who can only target their own shop) gets `404` and cannot change the rejected shop.

Decision reasons and visibility:
- [x] Rejecting an application (`PENDING` → `REJECTED`) requires exactly one reason, `applicantReason`: without an `applicantReason`, with one under 10 or over 500 characters, or with an `internalReason` → `400`; the shop stays `PENDING`. A valid rejection stores that single reason as both the audit reason and `rejection.applicantReason`.
- [x] A rejected owner sees the rejection reason and time on web and mobile, and can correct and resubmit. *(Verified manually by the project owner on web, signed in, and Android, 2026-11-07.)*
- [x] After resubmission, the rejection reason remains in the audit history.
- [x] Each of the other five decisions without an `internalReason`, or with one under 10 or over 500 characters → `400`, nothing changes; with a valid one, the reason is stored with decision type, actor, and timestamp.
- [x] `applicantReason` on any decision other than application rejection → `400`.
- [x] `internalReason` and `internalNote` never appear in any owner- or seller-facing response (shop details, status view, change requests, history), for every decision type.
- [x] The owner sees each outcome without a reason: `latestDecision.type` is `APPLICATION_APPROVED`, `APPLICATION_REJECTED`, `SUSPENDED`, or `REINSTATED` (a reinstated shop is distinguishable from an initially approved one, both with `status = APPROVED`), and the change request shows `APPROVED` or `REJECTED`.
- [x] `rejection` is present only while `status = REJECTED`; owner resubmission does not change `latestDecision`.
- [x] Each of the six decisions produces one owner notification with the outcome; no notification contains `internalReason`, `internalNote`, administrator identities, audit metadata, or the application-rejection reason.

Roles and access:
- [x] Creating or resubmitting an application does not grant `SELLER`.
- [x] A `PENDING` applicant can view and update the application, but is denied product and seller-order operations (`403`).
- [x] A `REJECTED` applicant can correct and resubmit and is denied seller operations (`403`).
- [x] Initial approval (including after a resubmission) grants `SELLER` in the same transaction; the user keeps `CUSTOMER` and can still use customer features.
- [x] An `APPROVED` seller can perform authorized seller operations.
- [x] A `SUSPENDED` seller can view the shop status but is denied all normal seller operations, field edits, change requests, and logo uploads (`403`), although the `SELLER` role remains.
- [x] Reinstatement (`SUSPENDED` → `APPROVED`) restores seller operations without writing a `UserRole` row, and is recorded as `REINSTATED`; nothing is restored before it commits.
- [x] A user holding `SELLER` whose shop is not `APPROVED` is denied (the status check is enforced, not only the role).
- [x] Client-provided roles or statuses (token claims, headers, query, body) never grant seller permissions.
- [x] A user cannot read or modify another user's shop or its resources (`404`), including by sending another shop's ID, change-request ID, or upload ID.
- [x] A customer is denied seller operations (`403`). Unauthenticated requests are denied (`401`).

Approved-shop editing:
- [x] On an `APPROVED` shop, `description`, `contactPhone`, `whatsappPhone`, and `address` update immediately with validation, and each change writes a `ShopFieldChangeEvent`.
- [x] On an `APPROVED` shop, `shopName` or `city` in a `PATCH` → `400`, nothing is written.
- [x] A `shopName`/`city` change request leaves `Shop.shopName`/`Shop.city` and every public response unchanged until an administrator decides.
- [x] A second change request while one is open → `409`.
- [x] Approving a change request applies the proposed values and audits them; rejecting it keeps the approved values and records the decision.
- [x] Submitting or deciding a change request never changes `Shop.status`. Racing decisions cannot both succeed (`409`).
- [x] Only administrators can decide change requests (`403` for owners and customers).

Logo upload:
- [x] Requesting an upload with an unsupported type (including `image/svg+xml`) or a declared size over 15 MB → `400`.
- [x] The presigned URL expires after 5 minutes, covers only the generated key, and rejects a body whose length or type differs from the signed headers. *(Expiry checked as the signed `X-Amz-Expires=300`; not waited out.)*
- [x] A file whose real content is not JPEG, PNG, or WebP (for example SVG or HTML renamed `.png`, or with a spoofed `Content-Type`) → `422`, `logoUrl` unchanged.
- [x] A file over 15 MB, or an image over 64 megapixels, or an undecodable image → `422`, `logoUrl` unchanged.
- [x] An image over 1024 × 1024 is reduced, keeping its proportions and format, and the published logo is at most 2 MB.
- [x] EXIF orientation is applied, and EXIF (GPS, device), XMP, IPTC, and ICC metadata and appended data are removed, on the server.
- [x] Only the normalized image becomes public, also after retries and recovery; each retry normalizes again and writes a new key.
- [x] A logo published before normalization stays served, and can be replaced or removed normally. *(Its object keeps its metadata until then; there is no backfill.)*
- [ ] A real Android phone photo with EXIF: orientation, removed metadata, dimensions, size, and public object. *(Not done: tests use generated photos, and no device was available.)*
- [x] Completing before uploading → `422` (`LOGO_NOT_UPLOADED`), and the upload stays retryable; completing another shop's upload → `404`; completing after `completeBy` → `410`.
- [x] Repeating completion of a `COMPLETED` upload returns the same `logoUrl` (`200`) and creates no new object, audit event, or state change.
- [x] Concurrent completion requests for one upload: exactly one claims it; the others get `409` (or `200` once it is completed); exactly one public object becomes `ACTIVE`.
- [x] A request whose lease expired cannot commit (attempt fencing), and the retry writes a new key instead of overwriting.
- [x] Failure injection: public write failure → `logoUrl` unchanged, upload retryable, object row `RELEASED`; database failure after the write → object not referenced, compensating delete attempted, object row `DELETED` or `RELEASED`; failed compensating delete → the reconciliation job deletes the orphan later.
- [x] Reconciliation never deletes an `ACTIVE` object or any object referenced by `Shop.logoUrl`, and a late completion of a reclaimed object rolls back.
- [x] Staging cleanup deletes the staging objects of completed, rejected, and expired uploads, never touches a `PROCESSING` upload with a live lease, and is safe to rerun.
- [x] Replacing an existing `ACTIVE` logo commits (the previous object is released before the new one is activated, under the partial unique index); a failure injected after the release rolls back, leaving the previous logo `ACTIVE` and referenced.
- [x] Stale attempt: an attempt whose lease expired while a newer attempt completed cannot commit, return the upload to `PENDING`, or change the newer `ACTIVE` object or `Shop.logoUrl`. It releases and deletes only its own object and responds with the current state (`200` with the newer `logoUrl`).
- [x] A database error during completion returns the upload to `PENDING` only while the attempt still holds the fence; it never overwrites a newer `COMPLETED` upload.
- [x] Abandoned `PROCESSING` upload with an expired lease: before `completeBy` the job moves it to `PENDING` (`LEASE_EXPIRED`) and keeps its staging object; after `completeBy` the job moves it to `EXPIRED` and deletes its staging object.
- [x] A stale worker that wakes after the job reclaimed its upload, or after a newer completion, changes nothing but its own object.
- [x] A failed staging or object delete is retried on the next run; objects referenced by `Shop.logoUrl` or `ACTIVE` are never deleted.
- [x] Replacing or removing a logo releases the previous object, which is then deleted.
- [x] A valid logo is copied to the media bucket, `logoUrl` is its public media URL (never a presigned URL or staging key), and the change is audited.
- [x] Staging objects are never publicly readable.
- [x] The flow passes against both SeaweedFS (local) and an R2-compatible configuration. *(SeaweedFS: `test/shop-logo-s3.test.ts`. Cloudflare R2: `test/shop-logo-r2.test.ts` and a real browser upload, 2026-11-08.)*

Administration and audit:
- [x] Only administrators can approve, reject, suspend, or reinstate; shop owners, customers, and sellers get `403`, unauthenticated requests `401`.
- [x] An administrator cannot approve, reject, suspend, or reinstate a shop they own, or decide its change requests, or read its administrative history (`403 SHOP_SELF_ADMINISTRATION_FORBIDDEN`); nothing changes. Another administrator can.
- [x] Invalid transitions return `409`, and racing transitions (including an owner edit racing an admin decision) cannot both succeed.
- [x] Suspension and reinstatement without a valid `internalReason` → `400`.
- [x] Every status change writes exactly one `ShopStatusEvent` with actor, reasons, internal note, and time, in the same transaction; a failed transition writes none.
- [x] Status changes are visible to the shop owner on web and mobile. *(Verified manually by the project owner on web, signed in, and Android, 2026-11-07.)*

## Logo Normalization Verification (2026-11-08)

- **Automated:** `test/shop-logo-normalizer.test.ts` covers JPEG, PNG, WebP, orientation, GPS, device, XMP, IPTC, and ICC removal, appended data, invalid signatures, HEIC refusal, oversized files, decompression bombs, output limits, corrupt images, retries, concurrency, storage and database failures, replacement, cleanup, and existing logos. Deliberately breaking the normalizer (publishing the original, skipping orientation, skipping the resize) makes these tests fail.
- **Cloudflare R2, test buckets only:** `test/shop-logo-r2.test.ts` passed 8/8, including a generated 3000 × 4000 photo with GPS and device data, read back from the public `r2.dev` URL as 1024 × 768 with no metadata. Nothing was checked on a hosted production deployment, which does not exist yet, and no storage setting was changed. One full test run failed all 8 with `fetch failed` before any logo logic ran; it passed alone and in the next full run, and the cause was not determined.
- **Browser, local SeaweedFS:** an 8.1 MB generated photo with orientation 6 was shown upright at 768 × 1024; the public object was 106 KB with no metadata (test-signed session).
