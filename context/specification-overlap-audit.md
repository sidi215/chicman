# Specification Overlap and Implementation Audit: Features 11–18

Date: 2026-11-09. Status: audit only. No feature was implemented, and no specification, status, schema, or code was changed.

## How to read this report

**References.** `S11 L24` means `context/feature-specs/11-order-management.md`, line 24. `Overview` is `context/project-overview.md`, `Arch` is `context/architecture.md`, and `Tracker` is `context/progress-tracker.md`. API paths are relative to `apps/api/src/`, web paths to `apps/web/src/`, and mobile paths to `apps/mobile/lib/`. `C1` is a conflict in section E and `Q1` is a question in section G.

**What was inspected**

| Source | Coverage |
|---|---|
| Specs 01, 02, 04–18 | Read in full |
| Spec 03 | Lines 1–423 read in full. Lines 424–581 are verification notes, checked by keyword for orders, roles, notifications, and security events |
| `project-overview.md`, `architecture.md`, `code-standards.md`, `ai-workflow-rules.md`, `ui-context.md` | Read in full |
| `progress-tracker.md` | Lines 1–358 and 695–835 read. Lines 359–694 (older history) checked by keyword only |
| Code | `prisma/schema.prisma` and migrations, API routes and the relevant services, workers, shared contracts, web routes and features, mobile features, Docker Compose |

**Limits of the evidence**

- "Exists in code" is not "verified end to end". No tests were run for this audit.
- Statements about manual verification come from the tracker and specs and were not repeated. The tracker records that spec 09 has not been checked with a real Supabase account or on Android.
- The Meilisearch service is configured in Compose but was not running during this audit.

**Counting method.** One row is one distinct requirement. Requirements repeated within a spec are merged and all their lines are cited. Verification checklist lines are counted only when they add a rule. "Do not build X" statements are not counted: they are listed in section H.

## A. Executive Summary

**Bottom line:** the order chain (10 → 11 → 12 → 13) cannot start until the project owner makes a small set of decisions. None of it exists in code. Features 14, 15, 16, and 18 can go ahead with conditions. Feature 17 is partly built, but its remaining scope needs decisions.

| Classification | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | Total |
|---|---|---|---|---|---|---|---|---|---|
| ALREADY IMPLEMENTED | 0 | 0 | 0 | 1 | 1 | 7 | 4 | 1 | 14 |
| PARTIALLY IMPLEMENTED | 3 | 2 | 1 | 3 | 5 | 4 | 4 | 1 | 23 |
| SPECIFIED BUT NOT IMPLEMENTED | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| DUPLICATE REQUIREMENT | 5 | 2 | 2 | 1 | 2 | 1 | 2 | 1 | 16 |
| EXTENSION | 1 | 1 | 2 | 3 | 4 | 0 | 1 | 5 | 17 |
| SHARED WORKFLOW | 2 | 2 | 6 | 0 | 0 | 1 | 0 | 0 | 11 |
| CONFLICT | 2 | 4 | 0 | 1 | 1 | 1 | 2 | 1 | 12 |
| NEW REQUIREMENT | 4 | 6 | 5 | 6 | 2 | 1 | 2 | 4 | 30 |
| UNCLEAR | 3 | 2 | 2 | 0 | 3 | 1 | 1 | 1 | 13 |
| **Requirements reviewed** | 21 | 20 | 18 | 15 | 18 | 16 | 16 | 14 | **138** |

These counts come from the rows in section B. Each row has one main classification, so a duplicated rule that is also partly built appears once. The 12 conflict rows map to 15 distinct conflicts in section E, because some conflicts involve Feature 10 or more than one row. "ALREADY IMPLEMENTED" here means present in code with tests or recorded verification, within that row's scope: it never means a whole feature is done.

**Most important findings**

1. **Features 10–13 have no code.** The schema has no order, delivery, payment, or checkout model (`prisma/schema.prisma`). Only comments mention them. Most of what looks like overlap here is specification overlap, not duplicate code.
2. **Order creation has two owners.** S10 L146 and S11 L44 each claim it (C2).
3. **Two status lists overlap and no mapping exists.** S11 and S12 both define `OUT_FOR_DELIVERY` and `DELIVERED`, and also `FAILED_DELIVERY` / `FAILED` (C3).
4. **The delivery fee has no source.** S10 needs it before the order exists, S12 reads as if it is set afterwards, and no field stores it (C4).
5. **No spec says when stock is taken or returned.** S10 L104 requires explicit rules, and S11, S12, and S13 are silent (Q1). A seller who never responds could hold stock indefinitely (Q7).
6. **A suspended shop cannot process its open orders.** Suspension blocks all seller order and delivery operations, and no spec says what happens to those orders (C5).
7. **S16 calls Flutter customer-only, but Flutter already has seller screens** (C6).
8. **S15's "existing outbox" does not exist** (C7). Feature 15 is otherwise a true extension: six shop decisions are already recorded.
9. **S18 contradicts specs 07 and 08 on sold-out products** (C8).
10. **Admin user oversight has a hidden dependency.** `User` stores no email, and the API has no Supabase secret key (Q14).

## B. Feature-by-Feature Comparison

### Feature 11: Order Management

No order code exists. Seller guards and audit patterns are ready to reuse.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **11.1** One checkout group with separate seller orders (L9, L27, L56) | S10 §3 L40–44; Arch invariant 7; Overview L27 | None | DUPLICATE REQUIREMENT | Define the data model once, in feature 11. S10 uses it |
| **11.2** Sellers manage only their own orders, checked on every operation (L10, L46, L57) | S10 L53; S06 rule 6 (L286); S03 L266–271 | `approvedSeller` guard and `req.sellerShop` (`modules/auth/auth.guards.ts`, `middleware/require-approved-seller.ts`). No order routes | PARTIALLY IMPLEMENTED | Reuse the guard and scope lookups by `req.sellerShop.id`; another shop's order is `404` |
| **11.3** Seller decisions are independent (L11, L58) | S10 L44–46; Arch invariant 8; Overview L28 | None | DUPLICATE REQUIREMENT | Implement once in the seller-order lifecycle |
| **11.4** A seller order stays `PENDING` until the seller responds (L12, L59) | S10 L50–52 | None | DUPLICATE REQUIREMENT | Implement once. Q7 covers a seller who never responds |
| **11.5** Pre-delivery statuses `PENDING`, `CONFIRMED`, `REJECTED`, `PROCESSING`, `READY_FOR_DELIVERY`, `CANCELLED` (L13–21) | S10 L50 names `PENDING` only | None | NEW REQUIREMENT | Add the enum and transition table. No actor is named for `PROCESSING` or `READY_FOR_DELIVERY` (Q4) |
| **11.6** Delivery-phase statuses `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED_DELIVERY` (L19–22) | S12 L15–21 | None | CONFLICT | C3 |
| **11.7** Validated transitions with an authorized actor (L23, L61) | Pattern: S06 L53 | Pattern: conditional updates in `modules/shops/shop-lifecycle.ts`, `shop-policy.ts` | NEW REQUIREMENT | New rules, same technique |
| **11.8** Customer may cancel only before confirmation, "according to the agreed cancellation policy" (L24, L60) | Overview L116 says "before shipment" | None | CONFLICT | C1 |
| **11.9** Returns are handled by the seller, with no platform workflow (L25) | Overview L107 | None | UNCLEAR | Q10 |
| **11.10** Order item snapshots (L26, L62) | S07 L96, L222; S05 L61; Arch invariant 9 | None. `CartItem` holds only variant values and a price snapshot, and is not an order record | SPECIFIED BUT NOT IMPLEMENTED | Copy from product rows at commit, not from the cart's `priceSnapshot`. Store variant text (variants are hard-deleted, `product.service.ts:191`) |
| **11.11** Transactional order creation from checkout (L44) | S10 L146, L153, L155 | None | DUPLICATE REQUIREMENT | C2 |
| **11.12** Each seller order belongs to exactly one shop (L45, L55) | S09 L24 (grouping) | `CartItem.shopId`; grouping in `CartService.loadCart` | SHARED WORKFLOW | Group by the product's current shop at commit |
| **11.13** Customers cannot read another customer's orders (L47, L64) | Arch L159; S03 L239 | `guards.user` and the `/customers/me/*` pattern. No order routes | PARTIALLY IMPLEMENTED | Add `/customers/me/orders…`, with no customer ID in the path |
| **11.14** Status history with actor, time, and metadata (L48) | Pattern: S06 L113 | Pattern: `ShopStatusEvent`. No order history | NEW REQUIREMENT | Append-only table written in the same transaction |
| **11.15** Retries cannot duplicate orders (L49, L63) | S10 L108–110, L213 | None. No idempotency mechanism exists in the API | DUPLICATE REQUIREMENT | Implement once at the checkout entry point (C2) |
| **11.16** Keep internal notes and private seller data out of customer responses (L50) | S06 L91; S08 L213 | Pattern: field-by-field views (`shop-views.ts`, `product-views.ts`) | EXTENSION | Same technique for order views. See C9 for contact data |
| **11.17** Seller order screens on the web (L38) | S16 L20 | None | SHARED WORKFLOW | Build in feature 11. S16 links to them |
| **11.18** Customer order history, details, and cancellation on web and mobile (L38–39) | Overview L120 | None | NEW REQUIREMENT | New client features, following `features/cart/` |
| **11.19** Amounts in MRU (L29) | S09 L52; ui-context L188 | `lib/money.ts` `formatMru` on the web; the equivalent on mobile. Decimal strings in API responses | PARTIALLY IMPLEMENTED | Reuse the formatters |
| **11.20** Effect of rejection, cancellation, and failure on stock (not stated in S11; required by S10 L104) | S07 L106; S10 L102–104 | None | UNCLEAR | Q1 |
| **11.21** "Accepts or rejects the items assigned to their shop" (L5) against "their order" (L58) | S10 L51 | None | UNCLEAR | Q17 |

### Feature 12: Delivery Management

No delivery code exists. The seller guard exists, and the data to snapshot exists.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **12.1** Seller delivers; no Chicman fleet (L9–10) | S10 L70–76; Overview L124, L183 | None | DUPLICATE REQUIREMENT | State once; nothing to build beyond the seller-order link |
| **12.2** Each seller order has its own delivery lifecycle (L11, L60) | S10 L44 | None | NEW REQUIREMENT | One delivery record per seller order, unless Q5 allows several attempts |
| **12.3** Fee is determined by the seller; no unauthorized change after commitment (L12, L43, L58) | S10 L71, L80–90; Overview L125 | No fee field anywhere | CONFLICT | C4 |
| **12.4** Delivery data belongs to the seller order (L13) | S10 L44 | None | NEW REQUIREMENT | Foreign key to the seller order |
| **12.5** No delivery for a rejected, cancelled, or ineligible order (L14, L53) | S11 L13–22 | None | SHARED WORKFLOW | Feature 11 exposes eligibility. S12 does not say whether the record is created automatically (Q4) |
| **12.6** Delivery states `PENDING`, `ASSIGNED`, `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED` (L15–21, L55) | S11 L18–22 | None | CONFLICT | C3 |
| **12.7** Define how delivery transitions update the order (L22) | S11 L23 | None | UNCLEAR | Q4 |
| **12.8** Failed delivery responsibility belongs to the seller (L23) | S10 L74 | None | DUPLICATE REQUIREMENT | State once |
| **12.9** Customer sees delivery progress (L5, L24, L56) | Overview L115 | None | NEW REQUIREMENT | Customer-safe view on the order details |
| **12.10** Customer sees relevant contact information (L24) | S08 L213; S11 L50 | `Shop.contactPhone` and `whatsappPhone` exist but are never public | CONFLICT | C9 |
| **12.11** Buyer and seller communicate by phone (L25) | Overview L184 | Phones stored (`Shop`, `CustomerProfile`, `CustomerAddress.deliveryPhone`). No exposure | PARTIALLY IMPLEMENTED | Snapshot and expose per C9. Phones stay unverified (S03 L204): never label them verified |
| **12.12** Address and contact snapshot at order time (L44, L57) | Arch L49; S05 L61; S10 L123 | `CustomerAddress` is hard-deleted (`address.service.ts:165`), so a reference would break | SPECIFIED BUT NOT IMPLEMENTED | Checkout takes the snapshot on the seller order. S12 only reads it (Q11) |
| **12.13** Seller operations on delivery information (L42, L53) | S06 rule 6 | None | NEW REQUIREMENT | New routes under `/sellers/me/…` with `approvedSeller` |
| **12.14** Ownership through shop and seller order (L45, L54, L61) | S06 rule 6; S03 L266–271 | Guard exists; no routes | PARTIALLY IMPLEMENTED | Reuse the guard |
| **12.15** Status history with actors (L46) | S11 L48 | None | NEW REQUIREMENT | Decide with C3 whether order history covers it, to avoid two logs of one event |
| **12.16** Record the failure outcome and block false delivered states (L47, L59) | Overview L119, L131 | None | NEW REQUIREMENT | Add a failure reason. The reason list is undefined (Q5) |
| **12.17** Only customer-safe delivery data (L5, L48) | S06 L91 | Pattern: allowlisted views | EXTENSION | Same technique |
| **12.18** Failed delivery can be retried or closed; "do not invent a new retry policy if one already exists" (L49) | Overview L119 names handling only | No policy exists in any spec or decision | UNCLEAR | Q5 |
| **12.19** "Spec 13 owns cash collection and reconciliation" (L27) | S13 L28 | None | CONFLICT | C10 |
| **12.20** Seller delivery screens (web) and customer delivery status (mobile) (L36–37) | S16 L21 | None | SHARED WORKFLOW | Build screens in feature 12. S16 links to them |

### Feature 13: Cash on Delivery

No payment code exists. The architecture also has no payment module (section E, documentation inconsistencies).

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **13.1** COD is the only payment method; no gateway (L9–10) | S10 L59–64; Arch invariant 16; Overview L170, L177 | None | DUPLICATE REQUIREMENT | State once |
| **13.2** The seller collects the cash for their own delivery (L11) | S10 L66, L72; Overview L44 | None | DUPLICATE REQUIREMENT | State once |
| **13.3** Each seller order has an independent COD obligation (L12, L55) | S10 L44 | None | SHARED WORKFLOW | Created by the checkout transaction, updated by feature 13 |
| **13.4** Amount due comes from the committed snapshot, including the fee (L13, L43, L56) | S10 L88–90; Arch invariant 9 | None | SHARED WORKFLOW | Checkout computes and stores it. Feature 13 never recomputes |
| **13.5** No recalculation from catalog prices after checkout (L14) | S11 L26; contrast S09 L56 | Cart recalculates on every read, which is correct for carts only | SHARED WORKFLOW | Order and payment code must not call `evaluateCartLine` after commit |
| **13.6** Confirmation, delivery, and payment are separate facts (L15–17) | None | None | NEW REQUIREMENT | Separate status columns or records (Q9) |
| **13.7** Payment states `PENDING`, `COLLECTED`, `FAILED`, `CANCELLED` (L18–22) | None | None | NEW REQUIREMENT | Add the enum. Transitions are undefined (Q9) |
| **13.8** Collection only for an "eligible delivery" (L23, L57) | S12 L19 | None | UNCLEAR | Eligibility is undefined (Q9) |
| **13.9** Record who collected, when, and how much (L24, L62) | None | Pattern: `actorUserId` on audit tables | NEW REQUIREMENT | The actor is the authenticated shop owner, because no courier exists in the model |
| **13.10** Idempotent, no double collection (L25, L45, L59) | None | Pattern: conditional updates (S06 L53) | NEW REQUIREMENT | Conditional update from `PENDING` |
| **13.11** Failure or non-payment recorded without marking collected (L26, L61) | S12 L47 | None | SHARED WORKFLOW | Coordinate with C3 and Q5 |
| **13.12** Audit trail; protect completed records (L27, L49) | Pattern: S06 L116 | None | NEW REQUIREMENT | Append-only payment events. Corrections are undefined (Q9) |
| **13.13** Cannot collect more than the amount due (L47, L60) | None | None | UNCLEAR | Silent on less than the amount due (Q9) |
| **13.14** Seller ownership on collection (L46, L58) | S06 rule 6 | Guard exists; no routes | PARTIALLY IMPLEMENTED | Reuse the guard |
| **13.15** Never trust a client amount or status (L48) | Arch invariant 13; S10 L90 | Pattern: strict schemas; `accept-price` treats a client value as a precondition only (S09 L199–204) | EXTENSION | Apply the same rule |
| **13.16** Customer responses carry no audit metadata (L50) | S06 L91 | Pattern: allowlisted views | EXTENSION | Same technique |
| **13.17** Checkout creates the payment records (L43, L54) | S10 L146–153 | None | SHARED WORKFLOW | Same transaction as order creation (C2) |
| **13.18** Seller collection action (web) and customer payment status (mobile) (L37–38) | S16 L22; S10 L126 | None | SHARED WORKFLOW | Build in feature 13. S16 links to them |

### Feature 14: Favorites

No favorites code exists (the only mention is a comment in `app_shell.dart:15`). It can build directly on existing patterns.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **14.1** Favorites belong to the authenticated customer (L9, L36, L48) | S03 L237–239; Arch L159 | `guards.user`, `requireLoadedUser` | PARTIALLY IMPLEMENTED | Add routes under `/customers/me/favorites` |
| **14.2** No client customer ID accepted (L37) | S03 L239 | Enforced on existing routes by design | DUPLICATE REQUIREMENT | Follow the rule |
| **14.3** Guests browse but cannot save (L10) | S08 L27; S09 L16 | Pattern: guest state in `cart-provider.tsx`, `add-to-cart.tsx` | EXTENSION | Same guest handling |
| **14.4** Add and remove (L11, L35, L45, L47) | Overview L79 | None | NEW REQUIREMENT | New `modules/favorites/` (named in Arch L59) |
| **14.5** No duplicates; repeated requests are safe (L12, L38, L46) | None | Pattern: `ON CONFLICT` in `CartService.lockOrCreateCart` | NEW REQUIREMENT | Unique `(userId, productId)` and idempotent operations |
| **14.6** Favorites must reference existing products (L13) | S09 L213 | Cart gives hidden and unknown products the same `404` | NEW REQUIREMENT | Recommendation: use the same rule, so that a favorite cannot reveal a hidden product |
| **14.7** Hidden products do not become purchasable through favorites (L14, L50) | S07 L7; S08 L115; S09 §7 | **Enforced now:** `CartService.addItem` refuses hidden products and stock shortfalls (tested in `test/cart.test.ts`) | ALREADY IMPLEMENTED | Change nothing. Favorites must add to the cart only through the existing route |
| **14.8** Show current availability and price (L15) | S09 L205; S14 L39 | Current price of a hidden product is deliberately not exposed | CONFLICT | C11 |
| **14.9** Removing a favorite does not delete the product (L16) | None | None | NEW REQUIREMENT | Natural result of a join table |
| **14.10** Consistent with the product lifecycle and integrity rules (L17) | S07 L217 (no delete route) | Products are never hard-deleted; `CartItem` uses `RESTRICT` on products | EXTENSION | Same foreign key. A favorite survives archiving |
| **14.11** Separate from the cart (L18, L51) | S09 | Separate responsibility over the same product | NEW REQUIREMENT | No cart writes |
| **14.12** Same account's favorites on web and mobile (L19, L49) | S09 L133 | Pattern: server-held cart | NEW REQUIREMENT | Server state; both clients read it |
| **14.13** Current data uses the public visibility rules (L39) | S08 L39 | `PUBLIC_PRODUCT_WHERE`, `productVisibility`, `productAvailability` | PARTIALLY IMPLEMENTED | Reuse them. Never write a second definition |
| **14.14** Loading, empty, error, and unavailable states in French and Arabic (L20, L40, L52) | Arch invariant 15 | Patterns in cart screens | PARTIALLY IMPLEMENTED | Reuse the patterns |
| **14.15** Favorite control on cards and a favorites screen (L29–30) | S08 L215; ui-context L199, L211 | `ProductCard` on both platforms has no heart yet, and the mobile dock has no Favorites destination | EXTENSION | Extend the cards. Public pages are server-rendered, so state needs a client provider like `CartProvider` |

### Feature 15: Notifications

A real extension: the table and the write path for shop decisions exist. Nothing reads them, and no client shows them.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **15.1** Generated from business events, with server-chosen recipient and content (L9–10) | S06 L95, L106–109 | `recordShopDecisionNotification` (`modules/notifications/shop-notifications.ts`). No client route creates notifications | PARTIALLY IMPLEMENTED | Generalize this helper; do not add a second one |
| **15.2** In-app notifications (L11, L65) | S06 L342 ("not built") | Rows are recorded. No read route and no screen on either client | PARTIALLY IMPLEMENTED | Add the read API and interfaces |
| **15.3** Creation separate from delivery; no provider assumed (L12–13, L57–58) | Arch L55 | `deliveredAt` exists and nothing sets it. No delivery code | PARTIALLY IMPLEMENTED | Add an abstraction only; keep rows as in-app records |
| **15.4** Order, status, delivery, and COD events (L15–19) | S10 L129; Overview L136–139 | None. The sources do not exist yet | NEW REQUIREMENT | Add types as features 11–13 land |
| **15.5** Shop approval, rejection, suspension, reinstatement, and change-request events (L20–22) | S06 L95–104 | **Recorded now**, inside the decision transaction (`shop-lifecycle.ts:119`, `:204`; `test/shops.test.ts`) | ALREADY IMPLEMENTED | Do not recreate. Only make them readable |
| **15.6** Account or profile security events "if already defined" (L23) | S03: none defined | None | UNCLEAR | The condition is false today. Recommendation: treat as out of scope (Q15) |
| **15.7** Role and ownership; cannot read or change another user's (L24, L54, L63, L67) | Arch L159 | `Notification.userId` exists; no routes | PARTIALLY IMPLEMENTED | Scope every query by user |
| **15.8** Never expose internal reasons, notes, or audit data (L25, L56, L68) | S06 L107, L109 | Allowlisted payload in `shopDecisionPayload`; tested | DUPLICATE REQUIREMENT | Keep this approach for each new event type |
| **15.9** The rejection reason stays out of notifications (L26) | S06 L108 | Implemented and tested | DUPLICATE REQUIREMENT | Keep as is |
| **15.10** Distinguish created, delivered, and read (L27–31, L70) | S06 L342 | `createdAt`, `deliveredAt`, `readAt` on `Notification` (`schema.prisma:253`) | PARTIALLY IMPLEMENTED | Columns exist; no behaviour yet |
| **15.11** Reliable generation through "the existing… outbox approach" (L32, L69) | S06 L95; Arch L55 | No outbox. Rows are written in the business transaction | CONFLICT | C7 |
| **15.12** No duplicates on retry; idempotent creation (L33, L42, L55, L64) | None | No idempotency key or unique index on `Notification` | EXTENSION | Add a unique event key. Check existing rows when migrating |
| **15.13** List with pagination, unread count, mark as read (L34, L52–53, L65–66) | None | None | EXTENSION | New routes on the existing table |
| **15.14** Stable event and type contract (L50) | S06 | `SHOP_NOTIFICATION_TYPES` in `packages/shared/src/shops/constants.ts`; `type` is `VARCHAR(64)` | EXTENSION | Move or extend to a shared notification contract |
| **15.15** Recipient and resource reference (L51) | None | Recipient yes. Resource only as payload values | EXTENSION | Add a typed reference. Check authorization when opening a resource |
| **15.16** Web notification center and unread indicator (L43, L71) | ui-context L195 | None | NEW REQUIREMENT | New web feature, with the account-change guard of `cart-provider.tsx` |
| **15.17** Mobile "customer notification center" (L44) | S06 L90, L95, L322 | None. Owners also use Flutter's shop screen | UNCLEAR | Do owners see shop decisions on mobile? (C6, Q15) |
| **15.18** Administrators as recipients (L5) | None | None. The event list (L14–23) has no admin event | UNCLEAR | Q15 |

### Feature 16: Seller Dashboard

Roughly half of the screens exist. There is no dashboard shell, and nothing to show for orders yet.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **16.1** Web-only; "Flutter remains a customer-only application"; no seller screens in Flutter (L9–10, L49) | S06 L90, L322; Arch L9, L31; Tracker L736, L828 | `features/shop/presentation/shop_screen.dart` exists and is reachable from the account screen | CONFLICT | C6 |
| **16.2** Only an owner of an `APPROVED` shop performs normal operations (L11, L53–54) | S03 L266–271; S06 rule 6 | `requireApprovedSeller`; tested | ALREADY IMPLEMENTED | Reuse |
| **16.3** Pending or rejected applicants get only the permitted areas (L12, L55) | S06 rules 2–5 | `/seller/shop`, `features/shop/components/shop-dashboard.tsx`; tracker records owner verification on 2026-11-07 | ALREADY IMPLEMENTED | Keep; link from the new layout |
| **16.4** Suspended sellers perform no normal operations (L13, L55) | S06 L292 | Enforced; tested | ALREADY IMPLEMENTED | Keep. Open orders of a suspended shop are C5 |
| **16.5** The dashboard never replaces API authorization (L14, L54) | S03; Arch L163 | Pattern in place | DUPLICATE REQUIREMENT | Follow the rule |
| **16.6** A seller reaches only their own shop's resources (L15, L56) | S06 L291 | No shop ID in owner routes; another shop's resource is `404`; tested | ALREADY IMPLEMENTED | Follow the pattern for new routes |
| **16.7** Shop profile and settings (L17) | S06 | `/seller/shop` | ALREADY IMPLEMENTED | Link; do not rebuild |
| **16.8** Product, inventory, and stock management (L18–19) | S07 | `/seller/products…`, `features/products/`; API routes in `product.routes.ts`. Tracker: real-account sign-in pending | ALREADY IMPLEMENTED | Link; do not rebuild |
| **16.9** Orders, delivery, COD, and notifications sections (L20–23, L45, L57) | S11, S12, S13, S15 | None | SHARED WORKFLOW | Those features build the screens; S16 provides navigation |
| **16.10** Summaries from real persisted data (L24, L47, L58) | None | No summary endpoint | NEW REQUIREMENT | Add one endpoint only if existing routes cannot supply the data (L36) |
| **16.11** Seller layout and navigation (L42) | S06 L318 | No `seller/layout.tsx` and no `/seller` page. Links only in `account-panel.tsx:120` | PARTIALLY IMPLEMENTED | Add the shell around existing pages |
| **16.12** Show the shop status clearly (L43) | S06 L81–90 | Shown on `/seller/shop` only | PARTIALLY IMPLEMENTED | Show across the shell, using `GET /sellers/me/shop` |
| **16.13** Restricted states never expose internal reasons (L44) | S06 L91 | Implemented and tested | ALREADY IMPLEMENTED | Keep |
| **16.14** Loading, empty, and error states (L46, L59) | Patterns in S06, S07 | Present on existing pages only | PARTIALLY IMPLEMENTED | Add for new sections |
| **16.15** Responsive; French and Arabic; RTL (L48, L60–61) | Design system (`02-design-system.md`); Arch invariant 15 | Tokens and messages exist. Tracker: signed-in seller screens in Arabic not fully checked in a browser | PARTIALLY IMPLEMENTED | Check the new shell in both languages |
| **16.16** Web tests cover access control and workflows (L62) | `code-standards.md` L47 | Web tests cover logic outside components only; access control is tested in the API | UNCLEAR | Recommendation: API tests for authorization, web tests for navigation logic |

### Feature 17: Admin Dashboard

The shop part is built. Everything else is new, and several items lack rules.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **17.1** Web-only workspace with a protected layout (L9, L46) | S06 L319 | `/admin/shops` and `/admin/shops/[shopId]`. No `admin/layout.tsx` and no `/admin` page. The page redirects guests in the browser; the API enforces access | PARTIALLY IMPLEMENTED | Add the shell around existing pages |
| **17.2** Admin authorization server-side, on every operation (L10, L47, L59, L64) | S03 L238, L333; S06 rule 7 | `guards.role("ADMIN")` on all `/admin` routes; tested | ALREADY IMPLEMENTED | Reuse on new routes |
| **17.3** Approved provisioning; no public or client-side path (L11–12, L55, L60) | S06 L344; Tracker | `scripts/grant-admin.ts` (`admin:grant`); no route grants `ADMIN` | ALREADY IMPLEMENTED | Keep. Do not add a grant screen without a decision |
| **17.4** Respect the role model (L13) | Arch L123–128 | `UserRole` | ALREADY IMPLEMENTED | Reuse |
| **17.5** Application review, suspension, reinstatement, change requests, reasons (L15–17, L24, L48–49, L61–62) | S06 L58–77 | `modules/admin/`, `modules/shops/shop-lifecycle.ts`, `features/admin/`; tested | ALREADY IMPLEMENTED | Do not rebuild. No self-administration (S06 L52) stays |
| **17.6** User and account oversight (L18, L51, L65) | S04 L91; S03 L182 | None. `User` has no email column, and the API has no Supabase secret key | UNCLEAR | Q14 |
| **17.7** Product moderation and catalog oversight (L19, L51, L65) | S07 L217; S08 L39 | None. No moderation state or admin product route | CONFLICT | C12 |
| **17.8** Order and delivery oversight that does not bypass invariants (L20, L51, L66) | S11, S12 | None | NEW REQUIREMENT | Recommendation: read-only first (Q14) |
| **17.9** Category management "where supported" (L21) | S07 L40–48; S08 L49; Overview L53, L148 | Fixed enum `ProductCategory` | CONFLICT | C13 |
| **17.10** Statistics from real data, with defined period and meaning (L22, L27, L54, L67) | None | None | NEW REQUIREMENT | Definitions are needed for each number |
| **17.11** Sensitive decisions audited; history protected (L23, L50, L63) | S06 L111–116 | Done for shop decisions. Nothing for other admin actions; S07 L230 notes no product audit history | PARTIALLY IMPLEMENTED | Each new admin action needs its own audit |
| **17.12** Decision reasons are internal unless authorized (L25) | S06 L76, L91 | Implemented and tested | DUPLICATE REQUIREMENT | Keep |
| **17.13** No editing of identities or protected ownership fields (L26, L65) | S04 L62; S06 L134 | No such admin route exists | DUPLICATE REQUIREMENT | Do not add one |
| **17.14** Avoid exposing sensitive data unnecessarily (L52) | S04 L91; S06 L91 | Phone history has no API at all | EXTENSION | S04 says a future admin feature "would have to define" any endpoint: none is defined here |
| **17.15** Searchable, filterable, paginated lists (L53, L68) | S06 L345 | Shop list: `status`, `openChangeRequest`, `limit` ≤ 100. No search or paging (`admin.routes.ts`, `admin-shops.repository.ts`) | PARTIALLY IMPLEMENTED | Extend; other lists are new |
| **17.16** French and Arabic; RTL (L69) | Arch invariant 15 | `features/admin/messages.ts`. Tracker: signed-in admin screens in Arabic not fully checked in a browser | PARTIALLY IMPLEMENTED | Check in both languages |

### Feature 18: Search

Infrastructure is configured, but the API has no Meilisearch code. Search extends the catalog.

| New requirement | Earlier specification | Existing implementation | Classification | Required action |
|---|---|---|---|---|
| **18.1** PostgreSQL is the source of truth; the index is derived (L9–10, L62) | Arch L101, invariants 1, 10 | Catalog reads PostgreSQL | DUPLICATE REQUIREMENT | Keep |
| **18.2** Extend Spec 08; no second catalog API (L11, L46, L49) | S08 L129, L209 | `catalogListQuerySchema` notes that "a later search parameter is simply added here" (`packages/shared/src/products/catalog.ts`) | EXTENSION | Add the query to `GET /products` and keep its response shape |
| **18.3** Only publicly visible products (L12, L18, L55) | S07 L216; S08 L39 | `PUBLIC_PRODUCT_WHERE`; tested | PARTIALLY IMPLEMENTED | Recommendation: re-check result IDs in PostgreSQL with this filter (L22) |
| **18.4** "Respect… availability"; remove documents when products become unavailable (L13, L42) | S07 L7, L198; S08 L43, L148 | Sold-out products stay listed | CONFLICT | C8 |
| **18.5** French and Arabic matching, case, whitespace, Arabic text (L14–15, L54) | None | None. The product name comes in the seller's language (S08 L123) | NEW REQUIREMENT | Configure and test with real Arabic text |
| **18.6** Sorting and pagination (L16, L60) | S08 §6–7 | Implemented for the catalog | EXTENSION | Add relevance to `CATALOG_SORTS`; the three sorts stay |
| **18.7** Filters reuse catalog facets and attributes (L17) | S08 §5, L212 | `GET /products/facets` | EXTENSION | Reuse. Do not add a second facet route |
| **18.8** Document with public fields only (L18, L40) | S08 L213 | `PublicProductSummary`; public shop fields defined | NEW REQUIREMENT | Stock quantities, phones, and the address never go in |
| **18.9** Index follows catalog changes (L19, L41–42, L56–57) | Arch invariant 10 | No index code. S18 also omits shop suspension, image, and stock changes, all of which change eligibility | NEW REQUIREMENT | Cover `shop-lifecycle.ts`, images, variants, and stock too |
| **18.10** Async indexing with retry and reconciliation (L20, L43, L58) | Arch L63, invariant 12 | Pattern: `workers/retention-schedule.ts`, `advisory-lock.ts`. No queue exists | NEW REQUIREMENT | Recommendation: a periodic job in the existing worker |
| **18.11** PostgreSQL fallback if search is unavailable (L21, L61) | None | No text matching in the catalog today | UNCLEAR | Q16 |
| **18.12** Server validation; clients cannot supply raw filters (L22, L44–45, L59) | S08 L144, L209 | Strict query schema | EXTENSION | Build index filters only from validated fields |
| **18.13** Local Meilisearch service (L35) | Project setup (`01-project-setup.md`) | Compose `meilisearch` service (v1.15), `MEILI_*` in `infrastructure/docker/.env.example`. Not running during the audit | ALREADY IMPLEMENTED | Reuse. The API has no client library or configuration yet |
| **18.14** Search input, results, debouncing, and states on web and mobile (L32–33, L47–48, L63) | ui-context L199, L201 | Listing pages and failure views exist; no input; the mobile dock has no Search destination | EXTENSION | Add input to existing listings. No second results page |

## C. Existing Functionality That Must Be Reused

| Existing piece | Location | How to reuse it | Must stay unchanged |
|---|---|---|---|
| Auth guards | `modules/auth/auth.guards.ts`, `middleware/require-approved-seller.ts` | `user`, `approvedSeller`, `role("ADMIN")` on all new routes | Identity and roles only from the token and PostgreSQL |
| Visibility | `modules/products/product-visibility.ts` | `PUBLIC_PRODUCT_WHERE`, `productVisibility` for checkout, favorites, search | One definition only |
| Availability | `modules/inventory/availability.ts` | `isQuantityAvailable`, `isStockAvailable`, `productAvailability` | One definition only |
| Cart rules | `modules/cart/cart-rules.ts` | `evaluateCartLine` for checkout validation before commit | It only reports and writes nothing |
| Cart service | `modules/cart/cart.service.ts` | Input to checkout. Follow its lock order (cart, shop, product) | No cart rebuild; `read` keeps writing nothing |
| Product locks | `modules/products/product-lock.ts` | `isShopStillApproved`; shop before product. A checkout locking many products must sort them to avoid deadlocks | Seller write rules |
| Seller stock | `modules/inventory/stock.service.ts` | **Do not call it from orders.** It requires an editable product and an approved seller, so returning stock to an archived product would fail | Compare-and-set for sellers. Order stock changes need their own internal function |
| Lifecycle pattern | `modules/shops/shop-lifecycle.ts`, `shop-policy.ts` | Conditional updates, audit, and notification in one transaction | Shop rules |
| Audit pattern | `ShopStatusEvent` | Template for order and payment events | Existing history |
| Notifications | `modules/notifications/shop-notifications.ts`, `Notification` | Extend for every event | Allowlisted payloads; rejection reason excluded |
| Address API | `modules/addresses/`, `/customers/me/addresses` | Checkout selection and creation | One default per customer; the 10-address limit; the confirmed pin |
| Customer profile | `modules/customers/` | Fallback delivery phone (S05 L48) | Phone history stays private |
| Catalog | `modules/products/catalog.*`, `catalogListQuerySchema` | Extended by search | Public fields; no stock quantities |
| Rate limits, validation, errors | `middleware/rate-limit.ts`, `lib/validation.ts`, `lib/http-error.ts` | All new writes | Code-only error bodies |
| Worker | `workers/index.ts`, `retention-schedule.ts`, `advisory-lock.ts` | Any new periodic job, with its own lock | Rebuilding the worker resets the pending 24-hour check (Tracker L13) |
| Admin tools | `modules/admin/`, `scripts/grant-admin.ts` | Oversight routes follow them | No self-administration |
| Web cart state | `features/cart/cart-provider.tsx` | Pattern for favorites and notifications, including the account-change guard (`account` ref). Reload after checkout | The guard. `CartProvider` sits in the `(storefront)` layout, so checkout must sit under it or the state is unavailable |
| Web pieces | `lib/api-client.ts`, `lib/money.ts`, `components/ui/*`, `features/shop` `SectionCard` | All new screens | `components/ui/*` is protected (`ai-workflow-rules.md` L41) |
| Web addresses | `features/addresses/components/address-screens.tsx`, `location-picker.tsx` | Checkout. `AddressList` has no selection mode, so it needs an extension | Confirmation step |
| Mobile cart state | `features/cart/application/cart_providers.dart` | Same pattern, including the `_generation` guard | The guard |
| Mobile pieces | `core/network/api_client.dart`, `features/addresses/presentation/`, `features/catalog/presentation/catalog_widgets.dart`, `app_shell.dart` | Customer screens | `AddressListScreen` has no selection mode; it needs an extension |

### How checkout should consume the cart

| Question | Established | Open or recommended |
|---|---|---|
| Which validations repeat at checkout? | Publication, shop approval, variants, stock, current price (S10 L96–100; S09 L48). The cart reserves nothing (S09 L46) | Run `evaluateCartLine` again under locks |
| Are cart items copied to order items? | Items need purchase-time values (S11 L26), and the cart "is not a financial commitment" (S09 L58) | **Recommended:** copy from locked product rows. `priceSnapshot` is only the accepted price to compare against |
| When are cart items removed? | Must be consistent with order creation (S10 L112, L151) | **Recommended:** inside the order transaction, only the ordered lines (C14) |
| Is cart data independent from orders? | Yes in purpose (S09 L58, S11 L26) | **Recommended:** no foreign key from order items to cart items |
| Unavailable lines | Remove-only (S09 L205). Tracker L826 says checkout refuses non-purchasable lines | Block everything, or order the rest? (Q3) |
| Unaccepted price changes | `purchasable` stays `true` and the line stays counted (S09 L211) | Refuse until accepted? (Q3). Tracker L778 recommends refusing |
| Stale responses after an account change | Fixed on web and mobile (S09, Clients) | New client state must keep the same guard |

## D. Duplicate and Overlapping Requirements

| Functionality | Where | Type | Handling |
|---|---|---|---|
| Order creation and retries | S10 L146, L110; S11 L44, L49, L63 | **True duplicate** | C2 |
| Multi-shop split and independent decisions | S10 §3–4; S11 L9–12; Arch invariants 7, 8 | **True duplicate** | One lifecycle, in feature 11 |
| Seller responsibility for delivery and failure | S10 §6; S12 L9–10, L12, L23 | **True duplicate** | One statement; no extra code |
| COD only, seller collects | S10 §5–6; S13 L9–11 | **True duplicate** | One statement |
| Shop decision notifications and reasons | S06 L93–109; S15 L20–26; S17 L24–25 | **True duplicate; already implemented** | Keep existing code |
| Admin shop review | S06; S17 L15–17, L48–49 | **True duplicate; already implemented** | Add navigation only |
| Seller access rules | S03, S06; S16 L11–15; S11 L46; S12 L45; S13 L46 | **True duplicate; already implemented as a guard** | Reuse the guard |
| Checkout, order, delivery, payment records | S10; S11; S12; S13 | **Shared workflow** | One transaction creates order, delivery fee snapshot, and payment record |
| Order status, delivery status, payment status | S11 L13–22; S12 L15–21; S13 L18–22 | **Shared workflow with a conflict** | C3 and Q9 |
| Fee | S10 §7; S12 L12, L43; S13 L13 | **Shared workflow with a conflict** | C4 |
| Snapshots | S10 L123; S11 L26; S12 L44; S13 L13 | **Shared workflow** | Written once at checkout; read by others |
| Seller screens for orders, delivery, COD | S11 L38; S12 L36; S13 L37; S16 L20–22 | **Shared workflow** | Each feature builds its screens; S16 owns the shell |
| Notifications | S10 L129; S11–13 (events); S15 | **Shared workflow** | S15 owns the contract; features record events |
| Audit history | S11 L48; S12 L46; S13 L27; S17 L23 | **Extension** of the S06 pattern | One history per fact; avoid logging one event twice |
| Search and catalog | S08; S18 | **Extension** | Same route and response |
| Notification storage | S06; S15 | **Extension** | Same table |
| Seller and admin dashboards | S06, S07; S16, S17 | **Extension** | A shell around existing pages |
| Cart and favorites | S09; S14 | **Separate responsibility, same entity** | No shared table |
| Cart and order items | S09; S11 | **Separate responsibility, same entity** | Different lifetimes: live prices against frozen values |
| Customer address and order snapshot | S05; S12 L44 | **Separate responsibility, same entity** | Copy, never reference |
| Product stock and order stock | S07; S10 | **Separate responsibility, same column** | Seller compare-and-set, separate internal order function |

### Responsibility split for Feature 10

**S10 status:** not implemented; every checklist item is open. Tracker has no row for features 10–18.

| Responsibility | Recommended owner | Others |
|---|---|---|
| Validation, address choice, totals, idempotency, confirmation, cart clearing | **10** | Uses 09, 05 |
| Order tables, status rules, snapshots, seller and customer routes | **11** | 10 writes through it |
| Delivery record, progress, failure | **12** | Reads the 10 snapshot |
| Fee configuration | **Undecided** (C4) | Read by 10; displayed by 12 |
| Payment record shape and collection | **13** | 10 creates the row in its transaction |
| Stock taken | **10**, through `modules/inventory/` | Q1 |
| Stock returned | **11 and 12**, through `modules/inventory/` | Q1 |

## E. Conflicts and Inconsistencies

All resolutions below are **recommendations, not decisions**. Nothing was changed in any specification.

### C1. Customer cancellation window

1. **Overview L116:** "Customer cancellation before shipment."
2. **S11 L24:** "Customers can cancel an order only before the seller confirms it, according to the agreed cancellation policy."
- **Why they conflict:** an order between confirmation and shipment is cancellable under one and not the other. No "agreed cancellation policy" is documented anywhere.
- **Affected:** `modules/orders`, stock release, web and mobile order screens, notifications.
- **Recommendation:** adopt S11 (before confirmation), which is newer and more specific, then update the Overview. Owner confirms in Q6.

### C2. Two owners for order creation and idempotency

1. **S10 L146:** "Shop-specific order creation." and **L110:** "Use an idempotency mechanism…"
2. **S11 L44:** "Implement transactional order creation from a successful checkout." and **L49:** "Ensure retries cannot create duplicate orders."
- **Why they conflict:** the behaviour agrees, but each spec claims the operation, which invites two code paths.
- **Affected:** `modules/orders`, a checkout module, `modules/cart`.
- **Recommendation:** S11 owns the tables and a creation function that runs inside a given transaction. S10 owns the endpoint, validation, the idempotency key, and the transaction. Implement the two together.

### C3. Overlapping order and delivery states

1. **S11 L19–22:** `OUT_FOR_DELIVERY`, `DELIVERED`, `CANCELLED`, `FAILED_DELIVERY` as order states.
2. **S12 L18–21:** `OUT_FOR_DELIVERY`, `DELIVERED`, `FAILED`, `CANCELLED` as delivery states. **L22:** "Keep order status and delivery status distinct, but define how delivery transitions update the corresponding order state."
- **Why they conflict:** the same facts are stored twice with no mapping, and S11 L28 says delivery execution is not part of it. `ASSIGNED` (S12 L17) has no defined meaning in a model with no courier, and L26 rules out "automatic courier assignment".
- **Affected:** `modules/orders`, `modules/delivery`, COD eligibility, notifications, every status display.
- **Recommendation:** the delivery record is the source for the delivery phase, and the order status is updated in the same transaction, so the two cannot disagree:

| Delivery | Order |
|---|---|
| `PENDING`, created when the seller confirms | `CONFIRMED` |
| `ASSIGNED` (recommended meaning: seller has arranged a deliverer) | `READY_FOR_DELIVERY` |
| `OUT_FOR_DELIVERY` | `OUT_FOR_DELIVERY` |
| `DELIVERED` | `DELIVERED` |
| `FAILED` | `FAILED_DELIVERY` |
| `CANCELLED` | `CANCELLED` |

Owner confirms in Q4.

### C4. Delivery fee: source and timing

1. **S10 L80, L83:** "Before order creation, the customer must see:" and "Delivery fee for each shop." **L88:** "The backend must calculate the final amounts."
2. **S12 L42:** "Provide seller operations to create and update delivery information for eligible orders." **L43:** "Validate delivery fees and prevent unauthorized fee changes after the relevant order commitment." **L12:** "Delivery fees are determined and managed by the seller."
- **Why they conflict:** S10 requires the fee before an order exists. S12 places fee handling on existing orders. No field stores a fee, and S06's application fields are a strict allowlist (L120) without one.
- **Affected:** `Shop` or a new table, `modules/shops`, checkout, COD amount due, seller settings screens.
- **Recommendation:** the seller sets a fee in shop settings, checkout snapshots it on each seller order, and it cannot change afterwards. Owner decides the model in Q2. This also changes S06's allowlist, which needs an explicit update.

### C5. Suspended shops and open orders

1. **S06 L286 (rule 6)** includes seller orders and delivery in normal operations, requiring `APPROVED`. **L292:** "a `SUSPENDED` shop, get `403` for all normal seller operations." **Arch invariant 5:** only `APPROVED` shops can "process marketplace orders."
2. **S10 L52:** "An order remains pending until its seller responds." **S10 L73:** "Delivery responsibility belongs to the seller." **S13 L11:** cash is collected by the seller.
- **Why they conflict:** an open order cannot progress while its shop is suspended, and nothing can close it. Reinstatement may never come.
- **Affected:** `requireApprovedSeller` use on order routes, admin decisions, stock, COD, customer communication.
- **Recommendation:** block new orders, and let the owner decide in Q8 whether a suspended shop may finish confirmed orders. Do not loosen the guard for other operations.

### C6. Flutter and seller screens

1. **S16 L10:** "Flutter remains a customer-only application." **L49:** "Do not create seller screens in Flutter."
2. **Arch L9:** "Customer and seller mobile applications." **Arch L31:** mobile seller product management is "a future feature." **S06 L90:** "The seller dashboard (web and mobile)." **S06 L322:** `apps/mobile/lib/features/shop/`. **Tracker L736, L828:** mobile seller management is a future feature.
- **Why they conflict:** seller application and shop editing already ship in Flutter (`features/shop/presentation/shop_screen.dart`). "Remains" is not accurate.
- **Affected:** `apps/mobile/lib/features/shop/`, architecture docs, S15 L44, roadmap.
- **Recommendation:** read S16 as "no new seller dashboard in Flutter", keep the existing shop screens (this audit's rules forbid removing functionality without a decision), and update the docs. Owner decides in Q12.

### C7. "Existing outbox" that does not exist

1. **S15 L32:** "Use the existing architecture's transactional event/outbox approach where appropriate."
2. **Code and Arch L55:** rows are written in the business transaction. "delivery channels and a read API are not built yet." No outbox or event table exists. **Arch invariant 12** requires background processing for notifications.
- **Why they conflict:** the spec assumes infrastructure that isn't there.
- **Affected:** `modules/notifications`, workers.
- **Recommendation:** treat the `Notification` row as the transactional record, add a unique event key, and add a separate delivery job only when a channel exists. This meets "reliable" and "idempotent" with no new infrastructure.

### C8. Sold-out products in search

1. **S18 L13:** "Search must respect product publication, shop approval, availability…" **L42:** "Update or remove documents when products become unavailable or unpublished."
2. **S08 L43:** "A published product at zero stock stays visible and shows a clear unavailable state." **L148:** "Do not filter out-of-stock products by default; the availability filter is an explicit customer choice." **S07 L7** agrees.
- **Why they conflict:** removing sold-out products from search makes them disappear from search but not from listings. "Update or remove" permits the correct behaviour but also the wrong one.
- **Affected:** index document, reindex triggers, `catalogWhere`.
- **Recommendation:** keep sold-out products indexed with an `available` attribute and honour `availability=available`, matching S08. Remove documents only when a product stops being public.

### C9. Contact information

1. **S12 L24:** "Customers can see delivery progress and the relevant contact information."
2. **S08 L213:** "contact phones, the address, and the owner are never loaded." **S11 L50:** keep "private seller information out of customer-facing responses."
- **Why they conflict:** the rules are compatible only if order-scoped data differs from public data, which no spec says. "Relevant" is undefined. Nothing specifies what the seller sees of the customer either, including the GPS accuracy S05 L57 says is "kept for sellers' information."
- **Affected:** order and delivery views, snapshots.
- **Recommendation:** expose the shop's `contactPhone` only on the customer's own order, and the recipient phone and address only on the seller's own order. Public routes do not change. Owner confirms in Q11.

### C10. COD "reconciliation"

1. **S12 L27:** "Spec 13 owns cash collection and reconciliation."
2. **S13 L28:** "Do not introduce platform commission settlement, seller payouts, or a financial ledger…" S13 has no reconciliation requirement.
- **Why they conflict:** one spec assigns a duty that the other does not define.
- **Affected:** feature 13 scope.
- **Recommendation:** "reconciliation" means comparing amount due and amount collected per seller order. No ledger.

### C11. Price shown on hidden favorites

1. **S14 L15:** "Show the current product availability and price when displaying favorites."
2. **S14 L39:** "using the existing public product visibility rules." **S09 L205:** "the current price of a hidden product is not public."
- **Why they conflict:** a favorited draft or suspended-shop product would show a price that public routes hide.
- **Affected:** favorites response, cards.
- **Recommendation:** current price only for public products. A hidden product shows "unavailable" with no price and no link. Favorites hold no price snapshot.

### C12. Product moderation

1. **S17 L19:** "Product moderation and platform catalog oversight."
2. **S07 L217:** "only `DRAFT` → `PUBLISHED`, `DRAFT` → `ARCHIVED`, `PUBLISHED` → `ARCHIVED`, and `ARCHIVED` → `DRAFT`… Any other transition returns `409`." **S08 L39:** "Do not write a second definition." Transitions belong to approved owners only.
- **Why they conflict:** moderation needs a state or an actor that the lifecycle doesn't allow, and hiding a product changes `PUBLIC_PRODUCT_WHERE`, `productVisibility`, cart issue codes, and search. S17 does not define an action.
- **Affected:** product lifecycle, catalog, cart, favorites, search, audit.
- **Recommendation:** first release read-only, with moderation as a separate decision (Q14). If added, change the single visibility definition.

### C13. Category management

1. **S17 L21:** "Platform category management, where supported." **Overview L53:** "Manages platform categories and general marketplace settings."
2. **S07 L40–48:** "Initially support only" three categories. "Do not introduce unrelated marketplace categories." **ui-context L201:** "the only supported categories". Code: fixed `ProductCategory` enum.
- **Why they conflict:** the Overview promises management, which the model does not support. "Where supported" resolves it today to nothing.
- **Recommendation:** no category management in S17. Update the Overview wording.

### C14. Clearing the cart after checkout

1. **S09 L190:** `DELETE /customers/me/cart`, "checkout is its expected caller."
2. **S10 L112:** "Order creation and cart handling must be consistent if a database operation fails."
- **Why they conflict:** a separate request cannot be atomic with order creation, and it deletes lines that weren't ordered if partial checkout is allowed (Q3). Tracker L779 notes the second point.
- **Affected:** `CartService`, checkout.
- **Recommendation:** remove the ordered lines inside the order transaction. Keep the route for its own use. Correct the S09 note.

### C15. Addresses at checkout

1. **S10 L26–30:** the address must include "Recipient name" and "Optional location coordinates."
2. **S05 L47:** "Every address has a map location." **S05 L48:** fields are label, city, district, landmark, optional phone; no recipient. Code matches (`CustomerAddress`).
- **Why they conflict:** coordinates are mandatory, not optional, and a required field doesn't exist. `CustomerProfile.fullName` is nullable (S04 L151).
- **Affected:** addresses API and forms, checkout, snapshot.
- **Recommendation:** S05 stands on coordinates: manual pin placement already satisfies "Do not require GPS" (S10 L36). Owner decides the recipient source in Q11.

### Lower-severity documentation inconsistencies

| # | Location | Issue | Recommendation |
|---|---|---|---|
| D1 | `01-project-setup.md`, `02-design-system.md` | File numbers and titles are swapped: `01-project-setup.md` is titled "02", `02-design-system.md` is titled "01" | Rename or retitle |
| D2 | `ai-workflow-rules.md` L59 | Names `architecture-context.md`; the file is `architecture.md` | Correct |
| D3 | Tracker L780–781 | "spec 11 is empty", "spec 12 is empty": both now exist | Update when the owner next changes the tracker |
| D4 | Tracker L34–46 | No rows for features 10–18 | Add when they start |
| D5 | S08 L9 | "Authentication is required only when the customer proceeds to checkout." The cart also requires it (S09 L15; Tracker L732) | Correct S08 |
| D6 | S10 L51, S11 L5, S15 L16, status `CONFIRMED` | "Confirm" and "accept" are used for one action | Pick one label for the API; translations can differ |
| D7 | Arch L51–59 | Lists `orders`, `delivery`, `reviews`, `favorites` modules that don't exist yet, and no payment module, though S13 L35 proposes one | Add a boundary with feature 13 |
| D8 | Overview L78, L150; Arch L57 | Ratings, reviews, and reported issues have **no spec** among 01–18 | Q19 |
| D9 | S07 L230 | Calls Meilisearch a "spec 08 boundary"; S18 now owns it | Update |

## F. Missing Dependencies

| Feature | Dependency | Status |
|---|---|---|
| 10, 11 | Auth guards, roles | Implemented |
| 10 | Address API; selection mode on both clients | Partial: API yes, selection no |
| 10 | Cart rules and data | Implemented; not verified with a real account or on Android (Tracker L46) |
| 10 | Visibility and availability definitions | Implemented |
| 10 | Order tables (11) | Not implemented |
| 10 | Fee source (Q2, C4) | **Awaiting decision** |
| 10, 11 | Stock rules (Q1) and an internal inventory function | **Awaiting decision**; not implemented |
| 10 | Line handling (Q3) and recipient (Q11) | **Awaiting decision** |
| 11 | Checkout (10), implemented together (C2) | Not implemented |
| 11 | Cancellation (Q6), status actors (Q4), timeout (Q7), suspended shops (Q8) | **Awaiting decision** |
| 12 | Seller orders (11) | Not implemented |
| 12 | Mapping (Q4), failure (Q5), contact rules (Q11) | **Awaiting decision** |
| 13 | Seller orders (11), delivery outcome (12), amount due (10) | Not implemented |
| 13 | Eligibility, partial amounts, corrections (Q9); returns (Q10) | **Awaiting decision** |
| 14 | Auth, visibility, availability, cart route | Implemented |
| 14 | Hidden-product display (C11) | Recommendation needs confirmation |
| 15 | `Notification` table, shop write path | Partial |
| 15 | Order, delivery, and COD events | Not implemented; added as 11–13 land |
| 15 | Recipients (Q15) | **Awaiting decision** |
| 16 | Existing shop and product screens | Implemented |
| 16 | 11, 12, 13, 15 | Not implemented |
| 17 | Shop administration, provisioning | Implemented |
| 17 | 11, 12 for oversight | Not implemented |
| 17 | User data source, moderation, statistics (Q14) | **Awaiting decision** |
| 18 | Catalog, facets, visibility | Implemented |
| 18 | Compose service | Configured; no API client, configuration, or index job |
| 18 | Availability (C8), fallback (Q16), production hosting | **Awaiting decision** |

## G. Open Business Questions

Ordered by impact on the database, lifecycles, money, and API contracts. Recommendations are suggestions only.

### Blocks the order chain

**Q1. Stock.** When is stock taken: at checkout, or when the seller confirms? Which outcomes return it: rejection, customer cancellation, failed delivery? *Recommendation:* take at checkout in the order transaction (S10 L102 requires no overselling under concurrency), return on rejection and cancellation. What about a variant removed in the meantime (S07 L222), or a return that would pass the 1,000,000 limit (`Product_stock_range`)? *Recommendation:* no error; skip or cap, and record it.

**Q2. Delivery fee.** One flat fee per shop, or by city or area? Can it be zero? Where does the seller set it? What if none is set: can the shop receive orders? *Recommendation:* flat per shop for the first release. No fee set means the shop's lines cannot be checked out.

**Q3. Lines at checkout.** Does one non-purchasable line block the whole checkout, or are the others ordered? Does an unaccepted price change block it? *Recommendation:* block until the customer resolves it, because this is simpler and needs no partial cart logic. Refuse an unaccepted change (Tracker L778).

**Q4. Status ownership.** Confirm or change the C3 mapping. Who moves `PROCESSING` and `READY_FOR_DELIVERY`? What does `ASSIGNED` mean? Is the delivery record created on confirmation or by the seller? What single status does a customer see for a multi-shop group, or only per shop? *Recommendation:* the seller moves them; created on confirmation; per-shop statuses with no combined one.

**Q5. Failed delivery.** Can it be retried, how often, and who closes it? Does stock return? Reason list? *Recommendation:* seller may retry, or close, which returns stock if the goods are back. No platform limit.

**Q6. Cancellation.** Confirm C1. May a seller cancel after confirming, and with a reason? Must rejection or cancellation carry a reason, and does the customer see it? *Recommendation:* a required reason for seller rejection, shown to the customer. It is plainly a customer-facing field, unlike S06's internal reasons.

**Q7. Unanswered orders.** S10 L52 has no time limit. Does an order expire, and when? *Recommendation:* a limit is needed if Q1 takes stock at checkout. Owner chooses the duration.

**Q8. Suspended shop.** What happens to its `PENDING`, confirmed, and out-for-delivery orders (C5)? May an administrator cancel them? *Recommendation:* auto-cancel `PENDING`, return stock, and let the seller finish orders already in delivery.

### Blocks payment records

**Q9. COD rules.** Is collection allowed only after `DELIVERED`, or in the same action? Must the amount equal the amount due, or is partial collection allowed (S13 L47 forbids only more)? Can `FAILED` be retried after redelivery? How is a mistaken collection corrected? What does `DELIVERED` with payment still `PENDING` mean, and does anything close it? *Recommendation:* exact amount only, recorded by one action with delivery confirmation or right after. No client-supplied amount. Corrections recorded by appending an event, never by editing.

**Q10. Returns and refunds.** Overview L107 lists seller-managed returns and exchanges, and S11 L25 assigns them to the seller, but nothing defines any state, and S13 has no refund state. Is this entirely outside the platform in the first release? *Recommendation:* yes: state it explicitly, with no status.

**Q11. Snapshot and contact data.** Where does the recipient name come from: a new address field, or `fullName` (nullable)? Which phone is used? Which fields does the seller see (coordinates, accuracy, profile phone)? Does the customer see the shop's phone, WhatsApp, or address? *Recommendation:* C9.

### Scope and contract decisions

**Q12. Flutter and sellers.** Keep the shop screens, and is mobile seller management still planned (C6)? *Recommendation:* keep; no new seller work on mobile.

**Q13. Buying from one's own shop.** A shop owner holds `CUSTOMER`, and the cart allows it (Tracker L783). Should checkout? *Recommendation:* refuse at checkout, because a self-order can distort stock and statistics.

**Q14. Admin scope.** May administrators act on orders, or only read? Does S06's no-self-administration rule cover oversight of their own shop's orders? Does product moderation exist (C12)? What does user oversight show? `User` stores no email, so showing one means copying it to PostgreSQL or using a Supabase secret key on the API, which S03 L182 says is not currently configured. May administrators read the phone history (S04 L91)? Which statistics, over which period? *Recommendation:* read-only first; exclude own shop from any action; user list without emails until decided.

**Q15. Notification recipients.** Which events reach administrators (none is listed)? Do owners see shop decisions on mobile? Are account security events in scope, given none is defined? How long are notifications kept? *Recommendation:* no admin events yet; show owners their notifications on mobile if Q12 keeps the shop screens; security events out of scope.

**Q16. Search.** What does "PostgreSQL fallback" return: a simple match, or the listing with a message? Where is Meilisearch hosted in production? *Recommendation:* name and brand match with a clear degraded state.

**Q17. Item-level decisions.** Can a seller accept some items and reject others (S11 L5 against L58)? *Recommendation:* whole seller order only.

**Q18. Retention.** How long are orders, snapshots with personal data, and payment events kept (Tracker L776: no general policy)? This is separate from the existing 12-month phone history. Does an order block account deletion? (No deletion route exists today.)

**Q19. Reviews and reported issues.** Listed in the Overview and Arch with no spec. Are they in the first release? *No recommendation; this is a product decision.*

## H. Recommended Implementation Boundaries

### Feature 11: Order Management
- **Implement:** order group, seller order, order item, status history, transitions, seller and customer routes, seller screens, customer history on web and mobile.
- **Reuse:** guards, lifecycle and audit patterns, allowlisted views, `formatMru`, rate limits.
- **Do not rebuild:** cart, product, or shop rules. **Do not change:** discovery, authentication, profile, or shop approval (L51). No automatic returns workflow (L25). No payment collection or delivery execution (L28).
- **Integrates with:** `modules/inventory`, `modules/notifications`, `modules/cart` (through 10).
- **Depends on:** Q1, Q4, Q6, Q7, Q8; delivered together with 10.

### Feature 12: Delivery Management
- **Implement:** delivery record, seller progress and outcome actions, customer view, delivery screens.
- **Reuse:** seller guard, order snapshot, status history pattern.
- **Do not rebuild:** addresses or maps; the snapshot is read-only. No GPS tracking, courier maps, third-party integration, or automatic assignment (L26). No cash handling (L27).
- **Integrates with:** `modules/orders`, `modules/notifications`.
- **Depends on:** 11; Q2, Q4, Q5, Q11.

### Feature 13: Cash on Delivery
- **Implement:** payment record, collection action, payment events, seller and customer displays.
- **Reuse:** conditional update and audit patterns; the committed amount.
- **Do not rebuild:** price or total calculation. No gateway, wallet, ledger, commission, or payouts (L10, L28).
- **Integrates with:** checkout transaction (row creation), `modules/delivery`, `modules/notifications`. Needs a new architecture boundary.
- **Depends on:** 10, 11, 12; Q9, Q10.

### Feature 14: Favorites
- **Implement:** favorite table, routes, heart control, favorites screens, mobile dock destination.
- **Reuse:** guards, visibility, availability, `ProductCard`, the client provider pattern with its account-change guard.
- **Do not rebuild:** discovery or cart (L41). No automatic cart changes (L18).
- **Integrates with:** `modules/products`, storefront layout, `app_shell.dart`.
- **Depends on:** nothing unbuilt; C11 confirmed.

### Feature 15: Notifications
- **Implement:** shared contract, generalized recording with an event key, list, unread count, mark as read, web and mobile interfaces, delivery abstraction only.
- **Reuse:** `Notification`, `recordShopDecisionNotification`, allowlisted payloads.
- **Do not rebuild:** the six shop notifications, or a second table. No SMS, email, or push provider (L58). No outbox product unless the owner asks (C7).
- **Integrates with:** `modules/shops`; 11, 12, and 13 as they arrive.
- **Depends on:** Q15. Split recommended: the contract and read API first, then events per feature.

### Feature 16: Seller Dashboard
- **Implement:** `/seller` shell, navigation, status display, overview summaries from real data.
- **Reuse:** `/seller/shop`, `/seller/products…`, `SectionCard`, feature APIs.
- **Do not rebuild:** shop, product, order, delivery, or COD logic. No analytics, payouts, ads, or multi-shop management (L25). No new Flutter seller screens (C6).
- **Integrates with:** every seller feature, `account-panel.tsx`.
- **Depends on:** 11, 12, 13, 15 for their sections. The shell can come first with existing pages.

### Feature 17: Admin Dashboard
- **Implement:** `/admin` shell, oversight lists, statistics, list paging and search.
- **Reuse:** `modules/admin`, `guards.role("ADMIN")`, `admin:grant`, `features/admin`, S06 decisions.
- **Do not rebuild:** shop decisions, reasons, or audit. No public admin registration (L55). No BI, accounting, payouts, or fraud detection (L28). No category management (C13).
- **Integrates with:** 11, 12, products, users.
- **Depends on:** Q14. Order oversight after 11 and 12.

### Feature 18: Search
- **Implement:** index document, index job, query parameter, relevance sort, inputs on both clients, fallback, configuration.
- **Reuse:** `GET /products`, `catalogListQuerySchema`, facets, `PUBLIC_PRODUCT_WHERE`, the worker pattern, the Compose service.
- **Do not rebuild:** a second catalog API or facet route (L49). No recommendations, AI, visual search, or sponsored ranking (L23). Meilisearch is never an authorization layer (L22).
- **Integrates with:** `modules/products`, `modules/inventory`, `shop-lifecycle.ts`, `workers`.
- **Depends on:** C8, Q16.

## I. Recommended Implementation Order

**Step 0: decisions.** Q1–Q11 and C1–C5. Nothing in the order chain is safe to build before these, because they shape tables that migrations then make costly to change.

| Step | Work | Why here |
|---|---|---|
| 1 | **15, first part:** shared contract, event key, read API, notification center | Orders need an idempotent way to record events from their first transaction. Small; it also finally shows existing shop notifications |
| 2 | **11 data and lifecycle, with 10:** tables, transitions, checkout, stock taken, cart lines removed, payment row created (13 shape only) | C2: they are one operation. Order tables must exist before checkout, and checkout is the only way to create orders. The payment row must exist from the first order (S13 L43) |
| 3 | **11 remainder:** seller decisions, cancellation, customer history, seller screens, stock returned | Needs orders to exist. Delivery depends on `CONFIRMED` |
| 4 | **12:** delivery records, progress, failure | Needs confirmed orders. COD depends on the delivery outcome |
| 5 | **13 remainder:** collection, payment events, displays | Eligibility depends on delivery state (S13 L23) |
| 6 | **16:** seller shell and summaries | Summaries and sections need 11–13 data. S16 L45 forbids duplicating it. The shell may come earlier |
| 7 | **17:** admin shell, oversight, statistics | Order oversight and statistics need steps 2–5. Reuses finished lists |
| Any time after C11 | **14** | Independent of orders. A good first feature if the decisions take time |
| Any time after C8 and Q16 | **18** | Independent of orders. Touches catalog write paths, so avoid overlapping with catalog changes |

**Why not numeric order:** 10 cannot be finished before 11's tables exist, 15 is needed by 11–13 rather than after them, and 14 is free of them all.

## J. Final Readiness Assessment

Feature 10 is outside the requested rating but controls the chain: **BLOCKED** (Q1, Q2, Q3, Q11; C2, C4, C15).

| Feature | Status | Reason |
|---|---|---|
| **11 Order Management** | **BLOCKED** | Stock (Q1), status mapping (C3, Q4), cancellation (C1, Q6), unanswered orders (Q7), and suspended shops (C5, Q8) all affect tables or lifecycles. Must be delivered with 10 |
| **12 Delivery Management** | **BLOCKED** | Fee source (C4, Q2), mapping (C3, Q4), and failure policy (Q5) are undecided. Needs 11 |
| **13 Cash on Delivery** | **BLOCKED** | Eligibility, amounts, corrections (Q9) and returns (Q10) are financial records that should not be guessed. Needs 10, 11, 12 |
| **14 Favorites** | **READY WITH CONDITIONS** | Confirm C11. All dependencies exist |
| **15 Notifications** | **READY WITH CONDITIONS** | Accept C7 and settle recipients (Q15). Read side can start now; order events follow 11–13 |
| **16 Seller Dashboard** | **READY WITH CONDITIONS** | The shell can start once C6 is settled. Order, delivery, and COD sections wait for 11–13, and notifications for 15 |
| **17 Admin Dashboard** | **BLOCKED** | Shop administration is done, but moderation (C12), order actions, user data, and statistics (Q14) lack rules. Order oversight needs 11 and 12. Only the shell around existing pages could start now |
| **18 Search** | **READY WITH CONDITIONS** | Confirm C8 and decide Q16. Meilisearch is configured, but the API integration is entirely new |
