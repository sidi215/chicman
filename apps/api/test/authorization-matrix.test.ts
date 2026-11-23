import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import dotenv from "dotenv";

import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

/**
 * Who may call each route (AT-1, `context/account-types-audit.md` section 7).
 *
 * - `public`: everyone, signed in or not.
 * - `intent`: no session needed (registration intent, before any session).
 * - `token`: a verified token, with or without an account (account setup).
 * - `user`: any account type (session, own profile).
 * - `buyer`, `buyerOrSeller`, `admin`: those account types only.
 * - `seller`: a Seller account, any shop status (the owner shop routes; their
 *   status rules come after the type check).
 * - `approvedSeller`: a Seller whose shop is `APPROVED`.
 * - `deliverySeller`: a Seller whose shop is `APPROVED` or `SUSPENDED` (D8).
 */
type Access = "public" | "intent" | "token" | "user" | "buyer" | "buyerOrSeller" | "seller" | "approvedSeller" | "deliverySeller" | "admin";

const ACCESS: Record<string, Access> = {
  "GET /api/v1/health": "public",
  "GET /api/v1/products": "public",
  "GET /api/v1/products/:productId": "public",
  "GET /api/v1/products/facets": "public",

  "POST /api/v1/registration-intents": "intent",
  "GET /api/v1/registration-intents/me": "token",
  "POST /api/v1/accounts/me/setup": "token",
  "GET /api/v1/accounts/me": "user",
  "PATCH /api/v1/accounts/me": "user",
  "GET /api/v1/session": "user",

  "GET /api/v1/customers/me/addresses": "buyer",
  "POST /api/v1/customers/me/addresses": "buyer",
  "GET /api/v1/customers/me/addresses/:addressId": "buyer",
  "PATCH /api/v1/customers/me/addresses/:addressId": "buyer",
  "DELETE /api/v1/customers/me/addresses/:addressId": "buyer",
  "POST /api/v1/customers/me/addresses/:addressId/default": "buyer",
  "GET /api/v1/customers/me/cart": "buyer",
  "DELETE /api/v1/customers/me/cart": "buyer",
  "POST /api/v1/customers/me/cart/items": "buyer",
  "PATCH /api/v1/customers/me/cart/items/:itemId": "buyer",
  "DELETE /api/v1/customers/me/cart/items/:itemId": "buyer",
  "POST /api/v1/customers/me/cart/items/:itemId/accept-price": "buyer",
  "GET /api/v1/customers/me/checkout": "buyer",
  "POST /api/v1/customers/me/checkout": "buyer",
  "GET /api/v1/customers/me/favorites": "buyer",
  "PUT /api/v1/customers/me/favorites/:productId": "buyer",
  "DELETE /api/v1/customers/me/favorites/:productId": "buyer",
  "GET /api/v1/customers/me/orders": "buyer",
  "GET /api/v1/customers/me/orders/:orderId": "buyer",
  "POST /api/v1/customers/me/orders/:orderId/shop-orders/:shopOrderId/cancel": "buyer",

  "GET /api/v1/customers/me/notifications": "buyerOrSeller",
  "GET /api/v1/customers/me/notifications/unread-count": "buyerOrSeller",
  "POST /api/v1/customers/me/notifications/read-all": "buyerOrSeller",
  "POST /api/v1/customers/me/notifications/:notificationId/read": "buyerOrSeller",

  "GET /api/v1/sellers/me/shop": "seller",
  "POST /api/v1/sellers/me/shop": "seller",
  "PATCH /api/v1/sellers/me/shop": "seller",
  "POST /api/v1/sellers/me/shop/resubmit": "seller",
  "POST /api/v1/sellers/me/shop/change-requests": "seller",
  "POST /api/v1/sellers/me/shop/logo/uploads": "seller",
  "POST /api/v1/sellers/me/shop/logo/uploads/:uploadId/complete": "seller",

  "GET /api/v1/sellers/me/products": "approvedSeller",
  "POST /api/v1/sellers/me/products": "approvedSeller",
  "GET /api/v1/sellers/me/products/:productId": "approvedSeller",
  "PATCH /api/v1/sellers/me/products/:productId": "approvedSeller",
  "POST /api/v1/sellers/me/products/:productId/publish": "approvedSeller",
  "POST /api/v1/sellers/me/products/:productId/archive": "approvedSeller",
  "POST /api/v1/sellers/me/products/:productId/restore": "approvedSeller",
  "PUT /api/v1/sellers/me/products/:productId/stock": "approvedSeller",
  "POST /api/v1/sellers/me/products/:productId/variants": "approvedSeller",
  "PATCH /api/v1/sellers/me/products/:productId/variants/:variantId": "approvedSeller",
  "DELETE /api/v1/sellers/me/products/:productId/variants/:variantId": "approvedSeller",
  "PUT /api/v1/sellers/me/products/:productId/variants/:variantId/stock": "approvedSeller",
  "POST /api/v1/sellers/me/products/:productId/images/uploads": "approvedSeller",
  "POST /api/v1/sellers/me/products/:productId/images/uploads/:uploadId/complete": "approvedSeller",
  "PUT /api/v1/sellers/me/products/:productId/images/order": "approvedSeller",
  "DELETE /api/v1/sellers/me/products/:productId/images/:imageId": "approvedSeller",
  "GET /api/v1/sellers/me/orders": "approvedSeller",
  "GET /api/v1/sellers/me/orders/:shopOrderId": "approvedSeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/confirm": "approvedSeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/reject": "approvedSeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/cancel": "approvedSeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/delivery/ready": "approvedSeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/delivery/dispatch": "approvedSeller",
  "GET /api/v1/sellers/me/payments/summary": "approvedSeller",

  "GET /api/v1/sellers/me/deliveries/in-progress": "deliverySeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/delivery/delivered": "deliverySeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/delivery/fail": "deliverySeller",
  "POST /api/v1/sellers/me/orders/:shopOrderId/delivery/close": "deliverySeller",

  "GET /api/v1/admin/shops": "admin",
  "GET /api/v1/admin/shops/:shopId": "admin",
  "POST /api/v1/admin/shops/:shopId/approve": "admin",
  "POST /api/v1/admin/shops/:shopId/reject": "admin",
  "POST /api/v1/admin/shops/:shopId/suspend": "admin",
  "POST /api/v1/admin/shops/:shopId/reinstate": "admin",
  "POST /api/v1/admin/shops/:shopId/change-requests/:requestId/approve": "admin",
  "POST /api/v1/admin/shops/:shopId/change-requests/:requestId/reject": "admin",
  "GET /api/v1/admin/orders": "admin",
  "GET /api/v1/admin/orders/:shopOrderId": "admin",
  "POST /api/v1/admin/orders/:shopOrderId/cancel": "admin",
  "POST /api/v1/admin/orders/:shopOrderId/payment/notes": "admin",

  // Product moderation (spec 19).
  "POST /api/v1/customers/me/product-reports": "buyer",
  "GET /api/v1/sellers/me/products/:productId/moderation": "seller",
  "POST /api/v1/sellers/me/products/:productId/moderation/resubmit": "approvedSeller",
  "GET /api/v1/admin/products": "admin",
  "GET /api/v1/admin/products/:productId": "admin",
  "POST /api/v1/admin/products/:productId/moderation/restrict": "admin",
  "POST /api/v1/admin/products/:productId/moderation/request-correction": "admin",
  "POST /api/v1/admin/products/:productId/moderation/restore": "admin",
  "POST /api/v1/admin/products/:productId/moderation/remove": "admin",
  "GET /api/v1/admin/moderation/cases": "admin",
  "GET /api/v1/admin/moderation/cases/:caseId": "admin",
  "POST /api/v1/admin/moderation/cases/:caseId/dismiss": "admin",
};

/** The route lister sees every router under `/api/v1`; the auth router is mounted at `/api/v1/auth`. */
const CALL_PATH: Record<string, string> = { "GET /api/v1/session": "/auth/session" };

type Who = "buyer" | "sellerApproved" | "sellerPending" | "sellerRejected" | "sellerSuspended" | "sellerWithoutShop" | "admin" | "adminDeactivated";
const EVERYONE: readonly Who[] = ["buyer", "sellerApproved", "sellerPending", "sellerRejected", "sellerSuspended", "sellerWithoutShop", "admin", "adminDeactivated"];
const SELLERS: readonly Who[] = ["sellerApproved", "sellerPending", "sellerRejected", "sellerSuspended", "sellerWithoutShop"];

/** Who passes the type and status guards of each access level (section 7). */
const ADMITTED: Record<Access, readonly Who[]> = {
  public: EVERYONE,
  intent: EVERYONE,
  token: EVERYONE,
  user: EVERYONE,
  buyer: ["buyer"],
  buyerOrSeller: ["buyer", ...SELLERS],
  seller: SELLERS,
  approvedSeller: ["sellerApproved"],
  deliverySeller: ["sellerApproved", "sellerSuspended"],
  admin: ["admin"],
};

describe("authorization matrix: every route × every account type (AT-1, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  const actors = {} as Record<Who, Actor>;

  before(async () => {
    await h.start();
    await h.reset();
    actors.buyer = await h.actor("BUYER");
    actors.sellerApproved = (await h.shopInStatus("APPROVED")).owner;
    actors.sellerPending = (await h.shopInStatus("PENDING")).owner;
    actors.sellerRejected = (await h.shopInStatus("REJECTED")).owner;
    actors.sellerSuspended = (await h.shopInStatus("SUSPENDED")).owner;
    actors.sellerWithoutShop = await h.actor("SELLER");
    actors.admin = await h.actor("ADMIN");
    actors.adminDeactivated = await h.actor("ADMIN");
    await h.prisma.user.update({ where: { id: actors.adminDeactivated.userId }, data: { adminAccessDeactivatedAt: new Date() } });
  });
  after(() => h.stop());

  const request = (route: string, token: string | null) => {
    const [method = "GET", template = ""] = route.split(" ");
    const path = CALL_PATH[route] ?? template.replace(/^\/api\/v1/, "").replace(/:[A-Za-z]+/g, () => randomUUID());
    return h.call(path, token, method === "GET" ? { method } : { method, body: {} });
  };

  it("classifies every route the app serves, and no route that does not exist", () => {
    assert.deepEqual(h.app.routes, Object.keys(ACCESS).sort());
  });

  it("refuses every account type a route does not admit (403), and guests on every protected route (401)", async () => {
    const failures: string[] = [];
    for (const [route, access] of Object.entries(ACCESS)) {
      const guest = await request(route, null);
      if (access !== "public" && access !== "intent" && guest.status !== 401) failures.push(`guest ${route} → ${guest.status}`);
      for (const who of EVERYONE) {
        if (ADMITTED[access].includes(who)) continue;
        const response = await request(route, actors[who].token);
        if (response.status !== 403) failures.push(`${who} ${route} → ${response.status}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  it("lets the admitted account types past the type and status guards (no 401 or 403)", async () => {
    const failures: string[] = [];
    for (const [route, access] of Object.entries(ACCESS)) {
      // Owner shop routes apply status rules after the type check (spec 06): the approved Seller stands for them.
      const admitted = access === "seller" ? (["sellerApproved"] as const) : ADMITTED[access];
      for (const who of admitted) {
        const response = await request(route, actors[who].token);
        if (response.status === 401 || response.status === 403) failures.push(`${who} ${route} → ${response.status}`);
      }
    }
    assert.deepEqual(failures, []);
  });

  it("shows every Seller its shop in any status, and refuses the shop routes to a Seller without one only by 404", async () => {
    for (const who of ["sellerApproved", "sellerPending", "sellerRejected", "sellerSuspended"] as const) {
      assert.equal((await request("GET /api/v1/sellers/me/shop", actors[who].token)).status, 200, who);
    }
    assert.equal((await request("GET /api/v1/sellers/me/shop", actors.sellerWithoutShop.token)).status, 404);
  });
});
