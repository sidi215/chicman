import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import type { OwnerShopResponse } from "@chicman/shared";
import dotenv from "dotenv";

import { TEST_SHOP_FIELDS } from "./helpers/database.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const APPLICATION = {
  shopName: "  Maison Lalla  ",
  description: "Melhfas et voiles.\r\nLivraison à Nouakchott.",
  contactPhone: "36 00 00 01",
  city: "Nouakchott",
  address: "Ksar, îlot B",
  whatsappPhone: "0022246000001",
};
const REASON = "Documents vérifiés, conforme.";
const REJECTION = "Adresse incomplète, merci de préciser l'îlot.";

/** Every key, at any depth, of a JSON value. */
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allKeys(item, keys);
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key);
      allKeys(child, keys);
    }
  }
  return keys;
}

const FORBIDDEN_OWNER_KEYS = ["internalReason", "internalNote", "actorUserId", "decidedByUserId", "submittedByUserId", "reason", "ownerUserId"];

function assertNoInternalData(body: unknown): void {
  const keys = allKeys(body);
  for (const key of FORBIDDEN_OWNER_KEYS) assert.ok(!keys.has(key), `owner response must not contain ${key}`);
}

describe("shop management (spec 06, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let admin: Actor;

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    admin = await h.actor(["CUSTOMER", "ADMIN"]);
  });

  const roles = async (userId: string) =>
    (await h.prisma.userRole.findMany({ where: { userId }, orderBy: { role: "asc" } })).map((r) => r.role);
  const create = (actor: Actor, body: unknown = APPLICATION) => h.call("/sellers/me/shop", actor.token, { method: "POST", body });
  const decide = (shopId: string, action: string, body: unknown, token = admin.token) =>
    h.call(`/admin/shops/${shopId}/${action}`, token, { method: "POST", body });
  const view = async (actor: Actor) => (await (await h.call("/sellers/me/shop", actor.token)).json()) as OwnerShopResponse;

  describe("creation and submission", () => {
    it("a customer without SELLER and without a shop creates a PENDING shop (201), visible in the review list", async () => {
      const customer = await h.actor();
      const res = await create(customer);
      assert.equal(res.status, 201);
      const body = (await res.json()) as OwnerShopResponse;
      assert.equal(body.status, "PENDING");
      assert.equal(body.shopName, "Maison Lalla");
      assert.equal(body.description, "Melhfas et voiles.\nLivraison à Nouakchott.");
      assert.equal(body.contactPhone, "+22236000001");
      assert.equal(body.whatsappPhone, "+22246000001");
      assert.equal(body.latestDecision, null);
      assert.equal(body.rejection, null);
      assertNoInternalData(body);
      assert.deepEqual(await roles(customer.userId), ["CUSTOMER"]);

      const list = await (await h.call("/admin/shops?status=PENDING", admin.token)).json();
      assert.deepEqual(
        (list as { shops: { id: string }[] }).shops.map((s) => s.id),
        [body.id],
      );
      const events = await h.prisma.shopStatusEvent.findMany({ where: { shopId: body.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0]?.fromStatus, null);
      assert.equal(events[0]?.toStatus, "PENDING");
      assert.equal(events[0]?.decisionType, null);
    });

    it("missing required fields or invalid values → 400 and nothing is written", async () => {
      const customer = await h.actor();
      const invalid: unknown[] = [
        ...["shopName", "description", "contactPhone", "city", "address"].map((field) => {
          const copy: Record<string, unknown> = { ...APPLICATION };
          delete copy[field];
          return copy;
        }),
        { ...APPLICATION, shopName: "x".repeat(101) },
        { ...APPLICATION, shopName: "   " },
        { ...APPLICATION, description: "x".repeat(2001) },
        { ...APPLICATION, address: "x".repeat(301) },
        { ...APPLICATION, contactPhone: "12" },
        { ...APPLICATION, whatsappPhone: "not a phone" },
        { ...APPLICATION, logoUrl: "https://evil.example/logo.png" },
        { ...APPLICATION, shopName: "Shop\u0007" },
        { ...APPLICATION, city: "Nouak\nchott" },
        { ...APPLICATION, description: "Bad\u0000text" },
        "not json",
        [],
      ];
      for (const body of invalid) {
        const res = await create(customer, body);
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      assert.equal(await h.prisma.shop.count(), 0);
    });

    it("protected fields, alone or mixed with valid fields, → 400 on create and update", async () => {
      const customer = await h.actor();
      const other = await h.actor();
      for (const extra of [
        { id: randomUUID() },
        { ownerUserId: other.userId },
        { ownerId: other.userId },
        { status: "APPROVED" },
        { roles: ["SELLER"] },
        { role: "SELLER" },
        { decisionType: "APPLICATION_APPROVED" },
        { internalReason: REASON },
        { createdAt: new Date().toISOString() },
        { updatedAt: new Date().toISOString() },
      ]) {
        assert.equal((await create(customer, { ...APPLICATION, ...extra })).status, 400);
      }
      assert.equal(await h.prisma.shop.count(), 0);

      assert.equal((await create(customer)).status, 201);
      for (const extra of [{ status: "APPROVED" }, { ownerUserId: other.userId }, { id: randomUUID() }, { roles: ["ADMIN"] }]) {
        assert.equal((await h.call("/sellers/me/shop", customer.token, { method: "PATCH", body: extra })).status, 400);
        const res = await h.call("/sellers/me/shop", customer.token, { method: "PATCH", body: { address: "Nouvelle adresse", ...extra } });
        assert.equal(res.status, 400);
      }
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { ownerUserId: customer.userId } });
      assert.equal(shop.status, "PENDING");
      assert.equal(shop.address, APPLICATION.address);
      assert.equal(await h.prisma.shopFieldChangeEvent.count(), 0);
    });

    it("the database refuses a second shop; concurrent creations produce exactly one (409 for the others)", async () => {
      const customer = await h.actor();
      const results = await Promise.all(Array.from({ length: 5 }, () => create(customer)));
      const statuses = results.map((r) => r.status).sort();
      assert.deepEqual(statuses, [201, 409, 409, 409, 409]);
      assert.equal(await h.prisma.shop.count({ where: { ownerUserId: customer.userId } }), 1);
      const again = await create(customer);
      assert.equal(again.status, 409);
      assert.deepEqual(await again.json(), { error: { code: "SHOP_ALREADY_EXISTS" } });
    });

    it("the owner is always the authenticated user", async () => {
      const customer = await h.actor();
      const other = await h.actor();
      assert.equal((await create(customer, { ...APPLICATION, ownerUserId: other.userId })).status, 400);
      assert.equal((await create(customer)).status, 201);
      assert.equal((await h.prisma.shop.findFirstOrThrow()).ownerUserId, customer.userId);
      assert.equal(await h.prisma.shop.count({ where: { ownerUserId: other.userId } }), 0);
    });

    it("the shop contact phone and the customer profile phone are independent", async () => {
      const customer = await h.actor();
      await create(customer);
      await h.call("/sellers/me/shop", customer.token, { method: "PATCH", body: { contactPhone: "+22236999999" } });
      const profile = await h.prisma.customerProfile.findUniqueOrThrow({ where: { userId: customer.userId } });
      assert.equal(profile.phone, "+22222000000");
      await h.prisma.customerProfile.update({ where: { userId: customer.userId }, data: { phone: "+22222111111" } });
      assert.equal((await view(customer)).contactPhone, "+22236999999");
    });

    it("pre-bootstrap tokens, unauthenticated requests, and users without a shop", async () => {
      assert.equal((await h.call("/sellers/me/shop", null, { method: "POST", body: APPLICATION })).status, 401);
      assert.equal((await h.call("/sellers/me/shop", null)).status, 401);
      const noShop = await h.actor();
      for (const [method, path] of [
        ["GET", "/sellers/me/shop"],
        ["PATCH", "/sellers/me/shop"],
        ["POST", "/sellers/me/shop/resubmit"],
        ["POST", "/sellers/me/shop/change-requests"],
        ["POST", "/sellers/me/shop/logo/uploads"],
        ["POST", `/sellers/me/shop/logo/uploads/${randomUUID()}/complete`],
      ] as const) {
        const res = await h.call(path, noShop.token, method === "GET" ? {} : { method, body: { address: "x" } });
        assert.equal(res.status, 404, `${method} ${path}`);
      }
    });
  });

  describe("resubmission", () => {
    it("REJECTED → PENDING; from PENDING, APPROVED, or SUSPENDED → 409 with the status unchanged", async () => {
      const customer = await h.actor();
      const { id } = (await (await create(customer)).json()) as OwnerShopResponse;
      assert.equal((await h.call("/sellers/me/shop/resubmit", customer.token, { method: "POST" })).status, 409);
      assert.equal((await decide(id, "reject", { applicantReason: REJECTION })).status, 200);
      const res = await h.call("/sellers/me/shop/resubmit", customer.token, { method: "POST" });
      assert.equal(res.status, 200);
      const body = (await res.json()) as OwnerShopResponse;
      assert.equal(body.status, "PENDING");
      // Owner actions are not decisions: latestDecision is still the rejection.
      assert.equal(body.latestDecision?.type, "APPLICATION_REJECTED");
      assert.equal(body.rejection, null);
      assert.deepEqual(await roles(customer.userId), ["CUSTOMER"]);

      for (const status of ["APPROVED", "SUSPENDED"] as const) {
        const { owner, shopId } = await h.shopInStatus(status);
        const conflict = await h.call("/sellers/me/shop/resubmit", owner.token, { method: "POST" });
        assert.equal(conflict.status, 409);
        assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, status);
      }
    });

    it("only the owner can resubmit: another user only reaches their own (missing) shop → 404", async () => {
      const { shopId } = await h.shopInStatus("REJECTED");
      const other = await h.actor();
      const res = await h.call("/sellers/me/shop/resubmit", other.token, { method: "POST", body: { shopId } });
      assert.equal(res.status, 404);
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "REJECTED");
    });
  });

  describe("decision reasons and visibility", () => {
    it("rejection requires exactly one applicantReason (10–500); internalReason is refused; the shop stays PENDING", async () => {
      const { shopId } = await h.shopInStatus("PENDING");
      for (const body of [
        {},
        { applicantReason: "too short" },
        { applicantReason: "x".repeat(501) },
        { internalReason: REASON },
        { applicantReason: REJECTION, internalReason: REASON },
        { applicantReason: REJECTION, internalNote: "" },
        { applicantReason: REJECTION, internalNote: "x".repeat(1001) },
        { applicantReason: "Raison avec\u0007contrôle" },
      ]) {
        assert.equal((await decide(shopId, "reject", body)).status, 400, JSON.stringify(body));
      }
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "PENDING");
      assert.equal(await h.prisma.shopStatusEvent.count(), 0);

      const res = await decide(shopId, "reject", { applicantReason: REJECTION, internalNote: "Vu avec l'équipe." });
      assert.equal(res.status, 200);
      const event = await h.prisma.shopStatusEvent.findFirstOrThrow({ where: { shopId } });
      assert.equal(event.decisionType, "APPLICATION_REJECTED");
      assert.equal(event.applicantReason, REJECTION);
      assert.equal(event.internalReason, null);
      assert.equal(event.internalNote, "Vu avec l'équipe.");
      assert.equal(event.actorUserId, admin.userId);
    });

    it("the rejected owner sees the reason and time; after resubmission it stays in the audit history", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await decide(shopId, "reject", { applicantReason: REJECTION, internalNote: "note interne" });
      const rejected = await view(owner);
      assert.equal(rejected.status, "REJECTED");
      assert.equal(rejected.rejection?.applicantReason, REJECTION);
      assert.ok(rejected.rejection?.rejectedAt);
      assertNoInternalData(rejected);

      await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { address: "Ksar, îlot B, lot 12" } });
      await h.call("/sellers/me/shop/resubmit", owner.token, { method: "POST" });
      assert.equal((await view(owner)).rejection, null);
      const history = await h.prisma.shopStatusEvent.findMany({ where: { shopId, decisionType: "APPLICATION_REJECTED" } });
      assert.equal(history[0]?.applicantReason, REJECTION);

      await decide(shopId, "approve", { internalReason: REASON });
      const detail = await (await h.call(`/admin/shops/${shopId}`, admin.token)).json();
      const events = (detail as { statusEvents: { decisionType: string | null; applicantReason: string | null }[] }).statusEvents;
      assert.deepEqual(
        events.map((e) => e.decisionType),
        ["APPLICATION_REJECTED", null, "APPLICATION_APPROVED"],
      );
      assert.equal(events[0]?.applicantReason, REJECTION);
    });

    it("the other five decisions require a valid internalReason; applicantReason → 400; nothing changes", async () => {
      const cases = [
        ["approve", "PENDING"],
        ["suspend", "APPROVED"],
        ["reinstate", "SUSPENDED"],
      ] as const;
      for (const [action, from] of cases) {
        const { shopId } = await h.shopInStatus(from);
        for (const body of [
          {},
          { internalReason: "short" },
          { internalReason: "x".repeat(501) },
          { applicantReason: REJECTION },
          { internalReason: REASON, applicantReason: REJECTION },
        ]) {
          assert.equal((await decide(shopId, action, body)).status, 400, `${action} ${JSON.stringify(body)}`);
        }
        assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, from);
        const ok = await decide(shopId, action, { internalReason: REASON });
        assert.equal(ok.status, 200);
        const event = await h.prisma.shopStatusEvent.findFirstOrThrow({ where: { shopId } });
        assert.equal(event.internalReason, REASON);
        assert.equal(event.applicantReason, null);
        assert.equal(event.actorUserId, admin.userId);
      }

      const { owner, shopId } = await h.shopInStatus("APPROVED");
      await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Nouadhibou" } });
      const requestId = (await view(owner)).changeRequest?.id ?? "";
      for (const action of ["approve", "reject"]) {
        for (const body of [{}, { internalReason: "short" }, { applicantReason: REJECTION }]) {
          const res = await h.call(`/admin/shops/${shopId}/change-requests/${requestId}/${action}`, admin.token, { method: "POST", body });
          assert.equal(res.status, 400);
        }
      }
      assert.equal((await h.prisma.shopChangeRequest.findUniqueOrThrow({ where: { id: requestId } })).status, "PENDING");
      const ok = await h.call(`/admin/shops/${shopId}/change-requests/${requestId}/reject`, admin.token, {
        method: "POST",
        body: { internalReason: REASON, internalNote: "Nom déjà utilisé" },
      });
      assert.equal(ok.status, 200);
      const request = await h.prisma.shopChangeRequest.findUniqueOrThrow({ where: { id: requestId } });
      assert.equal(request.internalReason, REASON);
      assert.equal(request.decidedByUserId, admin.userId);
      assert.ok(request.decidedAt);
    });

    it("owners see outcomes without reasons; REINSTATED is distinguishable from APPLICATION_APPROVED", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await decide(shopId, "approve", { internalReason: REASON, internalNote: "note interne" });
      const approved = await view(owner);
      assert.equal(approved.status, "APPROVED");
      assert.equal(approved.latestDecision?.type, "APPLICATION_APPROVED");
      assertNoInternalData(approved);

      await decide(shopId, "suspend", { internalReason: REASON, internalNote: "note interne" });
      const suspended = await view(owner);
      assert.equal(suspended.latestDecision?.type, "SUSPENDED");
      assertNoInternalData(suspended);

      await decide(shopId, "reinstate", { internalReason: REASON });
      const reinstated = await view(owner);
      assert.equal(reinstated.status, "APPROVED");
      assert.equal(reinstated.latestDecision?.type, "REINSTATED");

      await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { shopName: "Maison Lalla 2" } });
      const pending = await view(owner);
      assert.equal(pending.changeRequest?.status, "PENDING");
      await h.call(`/admin/shops/${shopId}/change-requests/${pending.changeRequest?.id}/approve`, admin.token, {
        method: "POST",
        body: { internalReason: REASON, internalNote: "ok" },
      });
      const decided = await view(owner);
      assert.equal(decided.changeRequest?.status, "APPROVED");
      assert.ok(decided.changeRequest?.decidedAt);
      assertNoInternalData(decided);
      // Every owner-facing response, including mutations, is allowlisted.
      const patched = await (await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { address: "Autre adresse" } })).json();
      assertNoInternalData(patched);
    });

    it("each of the six decisions records exactly one allowlisted owner notification", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await decide(shopId, "reject", { applicantReason: REJECTION, internalNote: "secret note" });
      await h.call("/sellers/me/shop/resubmit", owner.token, { method: "POST" });
      await decide(shopId, "approve", { internalReason: REASON, internalNote: "secret note" });
      await decide(shopId, "suspend", { internalReason: REASON });
      await decide(shopId, "reinstate", { internalReason: REASON });
      for (const action of ["approve", "reject"]) {
        await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: `Ville ${action}` } });
        const requestId = (await view(owner)).changeRequest?.id;
        await h.call(`/admin/shops/${shopId}/change-requests/${requestId}/${action}`, admin.token, {
          method: "POST",
          body: { internalReason: REASON, internalNote: "secret note" },
        });
      }
      const notifications = await h.prisma.notification.findMany({ orderBy: { createdAt: "asc" } });
      assert.deepEqual(
        notifications.map((n) => n.type),
        [
          "SHOP_APPLICATION_REJECTED",
          "SHOP_APPLICATION_APPROVED",
          "SHOP_SUSPENDED",
          "SHOP_REINSTATED",
          "SHOP_CHANGE_REQUEST_APPROVED",
          "SHOP_CHANGE_REQUEST_REJECTED",
        ],
      );
      for (const notification of notifications) {
        assert.equal(notification.userId, owner.userId);
        const text = JSON.stringify(notification.payload);
        for (const secret of [REASON, REJECTION, "secret note", admin.userId, admin.sub]) assert.ok(!text.includes(secret));
        const keys = [...allKeys(notification.payload)].sort();
        for (const key of keys) {
          assert.ok(["changeRequestOutcome", "decidedAt", "fields", "shopName", "shopStatus"].includes(key), key);
        }
      }
      const crApproved = notifications[4]?.payload as { fields: string[]; changeRequestOutcome: string };
      assert.deepEqual(crApproved.fields, ["city"]);
      assert.equal(crApproved.changeRequestOutcome, "APPROVED");
    });
  });

  describe("roles and access", () => {
    it("creating or resubmitting never grants SELLER; initial approval grants it in the same transaction and keeps CUSTOMER", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await decide(shopId, "reject", { applicantReason: REJECTION });
      await h.call("/sellers/me/shop/resubmit", owner.token, { method: "POST" });
      assert.deepEqual(await roles(owner.userId), ["CUSTOMER"]);
      await decide(shopId, "approve", { internalReason: REASON });
      assert.deepEqual(await roles(owner.userId), ["CUSTOMER", "SELLER"]);
      // Customer features still work.
      assert.equal((await h.call("/auth/session", owner.token)).status, 200);
    });

    it("a failed approval writes nothing: no status change, no event, no role, no notification", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      h.faults.lifecycle.beforeDecisionCommit = () => {
        throw new Error("injected");
      };
      assert.equal((await decide(shopId, "approve", { internalReason: REASON })).status, 500);
      delete h.faults.lifecycle.beforeDecisionCommit;
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "PENDING");
      assert.equal(await h.prisma.shopStatusEvent.count(), 0);
      assert.equal(await h.prisma.notification.count(), 0);
      assert.deepEqual(await roles(owner.userId), ["CUSTOMER"]);
    });

    it("suspension retains SELLER; reinstatement restores access without writing a UserRole row", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await decide(shopId, "approve", { internalReason: REASON });
      const granted = await h.prisma.userRole.findUniqueOrThrow({ where: { userId_role: { userId: owner.userId, role: "SELLER" } } });
      await decide(shopId, "suspend", { internalReason: REASON });
      assert.deepEqual(await roles(owner.userId), ["CUSTOMER", "SELLER"]);
      await decide(shopId, "reinstate", { internalReason: REASON });
      const after = await h.prisma.userRole.findUniqueOrThrow({ where: { userId_role: { userId: owner.userId, role: "SELLER" } } });
      assert.equal(after.createdAt.getTime(), granted.createdAt.getTime());
      assert.equal(await h.prisma.userRole.count({ where: { userId: owner.userId } }), 2);
      const events = await h.prisma.shopStatusEvent.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(
        events.map((e) => e.decisionType),
        ["APPLICATION_APPROVED", "SUSPENDED", "REINSTATED"],
      );
    });

    it("PENDING, REJECTED, and SUSPENDED owners: allowed and denied operations", async () => {
      for (const status of ["PENDING", "REJECTED"] as const) {
        const { owner } = await h.shopInStatus(status);
        assert.equal((await h.call("/sellers/me/shop", owner.token)).status, 200);
        const patch = await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { shopName: "Corrigé", city: "Rosso" } });
        assert.equal(patch.status, 200);
        assert.equal((await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Atar" } })).status, 403);
      }
      const { owner } = await h.shopInStatus("SUSPENDED");
      assert.equal((await h.call("/sellers/me/shop", owner.token)).status, 200);
      assert.equal((await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { address: "Nouvelle" } })).status, 403);
      assert.equal((await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Atar" } })).status, 403);
      const logo = await h.call("/sellers/me/shop/logo/uploads", owner.token, {
        method: "POST",
        body: { contentType: "image/png", contentLength: 100 },
      });
      assert.equal(logo.status, 403);
    });

    it("a user holding SELLER whose shop is APPROVED in name only (status not APPROVED) is denied edits of approved fields", async () => {
      const seller = await h.actor(["CUSTOMER", "SELLER"]);
      await h.shopInStatus("SUSPENDED", seller);
      assert.equal((await h.call("/sellers/me/shop", seller.token, { method: "PATCH", body: { description: "x" } })).status, 403);
      // An APPROVED shop without the SELLER role is denied approved-shop editing too.
      const roleless = await h.actor(["CUSTOMER"]);
      await h.shopInStatus("APPROVED", roleless);
      assert.equal((await h.call("/sellers/me/shop", roleless.token, { method: "PATCH", body: { description: "x" } })).status, 403);
    });

    it("client-provided roles or statuses (claims, headers, query, body) never grant anything", async () => {
      const claims = await h.actor(["CUSTOMER"], { role: "ADMIN", roles: ["ADMIN", "SELLER"], app_metadata: { roles: ["ADMIN"] } });
      const { shopId } = await h.shopInStatus("PENDING");
      const res = await h.call(`/admin/shops/${shopId}/approve?role=ADMIN`, claims.token, {
        method: "POST",
        body: { internalReason: REASON },
        headers: { "x-role": "ADMIN", "x-shop-status": "APPROVED" },
      });
      assert.equal(res.status, 403);
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "PENDING");
    });

    it("only administrators decide; owners, customers, and sellers → 403; unauthenticated → 401", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const seller = await h.actor(["CUSTOMER", "SELLER"]);
      const customer = await h.actor();
      for (const action of ["approve", "reject", "suspend", "reinstate"]) {
        const body = action === "reject" ? { applicantReason: REJECTION } : { internalReason: REASON };
        for (const actor of [owner, seller, customer]) assert.equal((await decide(shopId, action, body, actor.token)).status, 403);
        assert.equal((await h.call(`/admin/shops/${shopId}/${action}`, null, { method: "POST", body })).status, 401);
      }
      assert.equal((await h.call("/admin/shops", owner.token)).status, 403);
      assert.equal((await h.call(`/admin/shops/${shopId}`, seller.token)).status, 403);
      const approvedShop = await h.shopInStatus("APPROVED");
      await h.call("/sellers/me/shop/change-requests", approvedShop.owner.token, { method: "POST", body: { city: "Kiffa" } });
      const requestId = (await view(approvedShop.owner)).changeRequest?.id;
      for (const actor of [approvedShop.owner, customer]) {
        const res = await h.call(`/admin/shops/${approvedShop.shopId}/change-requests/${requestId}/approve`, actor.token, {
          method: "POST",
          body: { internalReason: REASON },
        });
        assert.equal(res.status, 403);
      }
      assert.equal(await h.prisma.shopStatusEvent.count(), 0);
    });

    it("unknown or other shops' IDs → 404 and are never disclosed", async () => {
      const a = await h.shopInStatus("APPROVED");
      const b = await h.shopInStatus("APPROVED");
      await h.call("/sellers/me/shop/change-requests", b.owner.token, { method: "POST", body: { city: "Kaédi" } });
      const bRequest = (await view(b.owner)).changeRequest?.id;
      // A change request addressed through another shop is not found.
      const crossed = await h.call(`/admin/shops/${a.shopId}/change-requests/${bRequest}/approve`, admin.token, {
        method: "POST",
        body: { internalReason: REASON },
      });
      assert.equal(crossed.status, 404);
      assert.equal((await decide(randomUUID(), "approve", { internalReason: REASON })).status, 404);
      assert.equal((await decide("not-a-uuid", "approve", { internalReason: REASON })).status, 404);
      // Owner routes take no shop ID: a body or query shop ID is refused or ignored.
      assert.equal(
        (await h.call(`/sellers/me/shop?shopId=${b.shopId}`, a.owner.token).then((r) => r.json()) as OwnerShopResponse).id,
        a.shopId,
      );
      assert.equal((await h.call(`/sellers/shops/${b.shopId}`, a.owner.token)).status, 404);
    });
  });

  describe("approved-shop editing", () => {
    it("immediate fields update with validation and one ShopFieldChangeEvent per changed field", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const res = await h.call("/sellers/me/shop", owner.token, {
        method: "PATCH",
        body: { description: "Nouvelle description", contactPhone: "+22236111111", whatsappPhone: "+22246111111", address: TEST_SHOP_FIELDS.address },
      });
      assert.equal(res.status, 200);
      const events = await h.prisma.shopFieldChangeEvent.findMany({ where: { shopId } });
      // `address` was unchanged: no event for it.
      assert.deepEqual(
        events.map((e) => [e.field, e.source, e.actorUserId]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        [
          ["description", "OWNER_UPDATE", owner.userId],
          ["contactPhone", "OWNER_UPDATE", owner.userId],
          ["whatsappPhone", "OWNER_UPDATE", owner.userId],
        ].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
      );
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "APPROVED");
      // whatsappPhone null clears it.
      await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { whatsappPhone: null } });
      assert.equal((await view(owner)).whatsappPhone, null);
      assert.equal((await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { contactPhone: "abc" } })).status, 400);
      assert.equal((await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: {} })).status, 400);
    });

    it("shopName or city in a PATCH of an APPROVED shop → 400 and nothing is written", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      for (const body of [{ shopName: "Autre" }, { city: "Atar" }, { description: "ok", city: "Atar" }]) {
        const res = await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body });
        assert.equal(res.status, 400);
        assert.deepEqual(await res.json(), { error: { code: "REVIEW_FIELD_NOT_EDITABLE" } });
      }
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      assert.equal(shop.description, TEST_SHOP_FIELDS.description);
      assert.equal(await h.prisma.shopFieldChangeEvent.count(), 0);
    });

    it("a failed update rolls back the fields and the audit events", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      h.faults.shop.afterShopUpdated = () => {
        throw new Error("injected");
      };
      assert.equal((await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { description: "Nouvelle" } })).status, 500);
      delete h.faults.shop.afterShopUpdated;
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).description, TEST_SHOP_FIELDS.description);
      assert.equal(await h.prisma.shopFieldChangeEvent.count(), 0);
    });

    it("change requests leave the approved values public until decided; one open request; decisions keep the status", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const submitted = await h.call("/sellers/me/shop/change-requests", owner.token, {
        method: "POST",
        body: { shopName: "  Nouveau Nom  ", city: "Nouadhibou" },
      });
      assert.equal(submitted.status, 201);
      const ownerView = (await submitted.json()) as OwnerShopResponse;
      assert.equal(ownerView.shopName, TEST_SHOP_FIELDS.shopName);
      assert.equal(ownerView.changeRequest?.proposedShopName, "Nouveau Nom");
      assert.equal(ownerView.changeRequest?.proposedCity, "Nouadhibou");
      let shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      assert.equal(shop.shopName, TEST_SHOP_FIELDS.shopName);
      assert.equal(shop.city, TEST_SHOP_FIELDS.city);

      const second = await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Atar" } });
      assert.equal(second.status, 409);
      assert.deepEqual(await second.json(), { error: { code: "CHANGE_REQUEST_OPEN" } });
      for (const body of [{}, { description: "x" }, { shopName: "" }, { city: "x".repeat(101) }]) {
        assert.equal((await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body })).status, 400);
      }

      // Racing decisions: exactly one wins.
      const requestId = ownerView.changeRequest?.id;
      const racing = await Promise.all(
        ["approve", "reject", "approve"].map((action) =>
          h.call(`/admin/shops/${shopId}/change-requests/${requestId}/${action}`, admin.token, {
            method: "POST",
            body: { internalReason: REASON },
          }),
        ),
      );
      assert.deepEqual(racing.map((r) => r.status).sort(), [200, 409, 409]);
      const request = await h.prisma.shopChangeRequest.findUniqueOrThrow({ where: { id: requestId ?? "" } });
      shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      assert.equal(shop.status, "APPROVED");
      if (request.status === "APPROVED") {
        assert.equal(shop.shopName, "Nouveau Nom");
        assert.equal(shop.city, "Nouadhibou");
        const events = await h.prisma.shopFieldChangeEvent.findMany({ where: { shopId } });
        assert.deepEqual(events.map((e) => e.source), ["CHANGE_REQUEST_APPROVED", "CHANGE_REQUEST_APPROVED"]);
        assert.ok(events.every((e) => e.actorUserId === admin.userId));
      } else {
        assert.equal(shop.shopName, TEST_SHOP_FIELDS.shopName);
        assert.equal(await h.prisma.shopFieldChangeEvent.count(), 0);
      }
      // A decided request frees the slot.
      assert.equal((await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Atar" } })).status, 201);
    });

    it("an open change request survives a suspension and can still be decided without affecting the status", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Zouérate" } });
      await decide(shopId, "suspend", { internalReason: REASON });
      const requestId = (await view(owner)).changeRequest?.id;
      const res = await h.call(`/admin/shops/${shopId}/change-requests/${requestId}/approve`, admin.token, {
        method: "POST",
        body: { internalReason: REASON },
      });
      assert.equal(res.status, 200);
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      assert.equal(shop.status, "SUSPENDED");
      assert.equal(shop.city, "Zouérate");
    });
  });

  describe("self-administration (an administrator cannot administer a shop they own)", () => {
    const SELF = { error: { code: "SHOP_SELF_ADMINISTRATION_FORBIDDEN" } };

    /** Everything a decision could change, for before/after comparison. */
    async function snapshot(shopId: string, ownerUserId: string) {
      const shop = await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
      return {
        shop,
        statusEvents: await h.prisma.shopStatusEvent.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
        fieldChanges: await h.prisma.shopFieldChangeEvent.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
        changeRequests: await h.prisma.shopChangeRequest.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
        notifications: await h.prisma.notification.findMany({ orderBy: { id: "asc" } }),
        logoObjects: await h.prisma.shopLogoObject.findMany({ where: { shopId }, orderBy: { id: "asc" } }),
        roles: await roles(ownerUserId),
      };
    }

    /** An account holding ADMIN and CUSTOMER that owns a shop in `status`. */
    async function adminOwner(status: "PENDING" | "APPROVED" | "SUSPENDED") {
      const owner = await h.actor(status === "PENDING" ? ["CUSTOMER", "ADMIN"] : ["CUSTOMER", "ADMIN", "SELLER"]);
      const { shopId } = await h.shopInStatus(status, owner);
      return { owner, shopId };
    }

    it("cannot approve or reject its own PENDING application; nothing changes", async () => {
      const { owner, shopId } = await adminOwner("PENDING");
      assert.deepEqual(await roles(owner.userId), ["CUSTOMER", "ADMIN"]);
      const before = await snapshot(shopId, owner.userId);
      for (const [action, body] of [
        ["approve", { internalReason: REASON, internalNote: "self" }],
        ["reject", { applicantReason: REJECTION }],
      ] as const) {
        const res = await decide(shopId, action, body, owner.token);
        assert.equal(res.status, 403, action);
        assert.deepEqual(await res.json(), SELF);
      }
      assert.deepEqual(await snapshot(shopId, owner.userId), before);
      // No SELLER grant from a self-approval attempt.
      assert.ok(!(await roles(owner.userId)).includes("SELLER"));
    });

    it("cannot suspend its own APPROVED shop or reinstate its own SUSPENDED shop; nothing changes", async () => {
      for (const [status, action] of [
        ["APPROVED", "suspend"],
        ["SUSPENDED", "reinstate"],
      ] as const) {
        const { owner, shopId } = await adminOwner(status);
        const before = await snapshot(shopId, owner.userId);
        const res = await decide(shopId, action, { internalReason: REASON }, owner.token);
        assert.equal(res.status, 403, action);
        assert.deepEqual(await res.json(), SELF);
        assert.deepEqual(await snapshot(shopId, owner.userId), before);
      }
    });

    it("cannot approve or reject its own change request; the request stays PENDING and the shop unchanged", async () => {
      const { owner, shopId } = await adminOwner("APPROVED");
      const submitted = await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { shopName: "Nom auto-approuvé", city: "Atar" } });
      assert.equal(submitted.status, 201);
      const requestId = (await view(owner)).changeRequest?.id;
      const before = await snapshot(shopId, owner.userId);
      for (const action of ["approve", "reject"]) {
        const res = await h.call(`/admin/shops/${shopId}/change-requests/${requestId}/${action}`, owner.token, {
          method: "POST",
          body: { internalReason: REASON },
        });
        assert.equal(res.status, 403, action);
        assert.deepEqual(await res.json(), SELF);
      }
      const after = await snapshot(shopId, owner.userId);
      assert.deepEqual(after, before);
      assert.equal(after.changeRequests[0]?.status, "PENDING");
      assert.equal(after.shop.shopName, TEST_SHOP_FIELDS.shopName);
    });

    it("cannot read its own shop's administrative history (internal reasons and notes)", async () => {
      const { owner, shopId } = await adminOwner("PENDING");
      await decide(shopId, "reject", { applicantReason: REJECTION, internalNote: "note interne" });
      const res = await h.call(`/admin/shops/${shopId}`, owner.token);
      assert.equal(res.status, 403);
      assert.deepEqual(await res.json(), SELF);
      // The review list (no internal data) still works for this administrator.
      assert.equal((await h.call("/admin/shops?status=REJECTED", owner.token)).status, 200);
    });

    it("a different administrator administers that shop normally, and the admin-owner administers other shops", async () => {
      const { owner, shopId } = await adminOwner("PENDING");
      const ok = await decide(shopId, "approve", { internalReason: REASON });
      assert.equal(ok.status, 200);
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, "APPROVED");
      assert.equal(await h.prisma.shopStatusEvent.count({ where: { shopId, actorUserId: admin.userId } }), 1);
      assert.equal(await h.prisma.notification.count({ where: { userId: owner.userId } }), 1);
      assert.equal((await h.call(`/admin/shops/${shopId}`, admin.token)).status, 200);

      await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Rosso" } });
      const requestId = (await view(owner)).changeRequest?.id;
      const decided = await h.call(`/admin/shops/${shopId}/change-requests/${requestId}/approve`, admin.token, {
        method: "POST",
        body: { internalReason: REASON },
      });
      assert.equal(decided.status, 200);
      assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).city, "Rosso");

      // The admin-owner keeps full administrator rights on shops it does not own.
      const other = await h.shopInStatus("PENDING");
      assert.equal((await decide(other.shopId, "approve", { internalReason: REASON }, owner.token)).status, 200);
      assert.equal((await h.call(`/admin/shops/${other.shopId}`, owner.token)).status, 200);
    });

    it("the owner's own seller operations are unchanged by holding ADMIN", async () => {
      const { owner } = await adminOwner("APPROVED");
      assert.equal((await h.call("/sellers/me/shop", owner.token)).status, 200);
      assert.equal((await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { address: "Nouvelle adresse" } })).status, 200);
      // ADMIN grants nothing on the owner side: a suspended admin-owner is still denied edits.
      const suspended = await adminOwner("SUSPENDED");
      assert.equal((await h.call("/sellers/me/shop", suspended.owner.token, { method: "PATCH", body: { address: "x" } })).status, 403);
    });

    it("an invalid body is still 400 and an unknown shop 404 for an admin-owner", async () => {
      const { owner, shopId } = await adminOwner("PENDING");
      assert.equal((await decide(shopId, "approve", {}, owner.token)).status, 400);
      assert.equal((await decide(randomUUID(), "approve", { internalReason: REASON }, owner.token)).status, 404);
    });
  });

  describe("administration and audit", () => {
    it("invalid transitions → 409 and write nothing", async () => {
      const invalid = [
        ["approve", "APPROVED"],
        ["approve", "REJECTED"],
        ["approve", "SUSPENDED"],
        ["reject", "APPROVED"],
        ["reject", "REJECTED"],
        ["suspend", "PENDING"],
        ["suspend", "REJECTED"],
        ["suspend", "SUSPENDED"],
        ["reinstate", "APPROVED"],
        ["reinstate", "PENDING"],
        ["reinstate", "REJECTED"],
      ] as const;
      for (const [action, status] of invalid) {
        const { shopId } = await h.shopInStatus(status);
        const body = action === "reject" ? { applicantReason: REJECTION } : { internalReason: REASON };
        const res = await decide(shopId, action, body);
        assert.equal(res.status, 409, `${action} from ${status}`);
        assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).status, status);
      }
      assert.equal(await h.prisma.shopStatusEvent.count(), 0);
      assert.equal(await h.prisma.notification.count(), 0);
    });

    it("racing transitions cannot both succeed (two admins; an owner edit or resubmission racing a decision)", async () => {
      const { shopId } = await h.shopInStatus("PENDING");
      const results = await Promise.all([
        decide(shopId, "approve", { internalReason: REASON }),
        decide(shopId, "reject", { applicantReason: REJECTION }),
        decide(shopId, "approve", { internalReason: REASON }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
      assert.equal(await h.prisma.shopStatusEvent.count({ where: { shopId } }), 1);

      const rejected = await h.shopInStatus("REJECTED");
      const [resubmit, approve] = await Promise.all([
        h.call("/sellers/me/shop/resubmit", rejected.owner.token, { method: "POST" }),
        decide(rejected.shopId, "approve", { internalReason: REASON }),
      ]);
      // Approval needs PENDING: it wins only if the resubmission committed first.
      if (approve.status === 200) {
        assert.equal(resubmit.status, 200);
        assert.equal((await h.prisma.shop.findUniqueOrThrow({ where: { id: rejected.shopId } })).status, "APPROVED");
      } else {
        assert.equal(approve.status, 409);
      }

      // A pending edit racing an approval: whatever the order, the edit
      // never lands on an APPROVED shop as an application edit of shopName.
      const pending = await h.shopInStatus("PENDING");
      const [edit, decision] = await Promise.all([
        h.call("/sellers/me/shop", pending.owner.token, { method: "PATCH", body: { shopName: "Renommé" } }),
        decide(pending.shopId, "approve", { internalReason: REASON }),
      ]);
      assert.equal(decision.status, 200);
      const finalShop = await h.prisma.shop.findUniqueOrThrow({ where: { id: pending.shopId } });
      if (edit.status === 200) {
        // The edit committed first and was approved with the application.
        assert.equal(finalShop.shopName, "Renommé");
      } else {
        assert.ok([403, 409, 400].includes(edit.status));
        assert.equal(finalShop.shopName, TEST_SHOP_FIELDS.shopName);
      }
    });

    /** Runs an action while the shop row is locked; returns the time the lock was released. */
    const lockedDuring = async (shopId: string, action: () => Promise<Response>): Promise<number> => {
      let release = (): void => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      let onLocked = (): void => undefined;
      const locked = new Promise<void>((resolve) => (onLocked = resolve));
      const holder = h.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM "Shop" WHERE "id" = ${shopId}::uuid FOR UPDATE`;
        onLocked();
        await held;
      });
      await locked;
      const pendingAction = action();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const releasedAt = Date.now();
      release();
      await holder;
      assert.equal((await pendingAction).status, 200);
      return releasedAt;
    };

    it("a change-request decision that waited for the shop lock is timestamped after the wait", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      await h.call("/sellers/me/shop/change-requests", owner.token, { method: "POST", body: { city: "Rosso" } });
      const request = await h.prisma.shopChangeRequest.findFirstOrThrow({ where: { shopId } });
      const releasedAt = await lockedDuring(shopId, () =>
        h.call(`/admin/shops/${shopId}/change-requests/${request.id}/approve`, admin.token, { method: "POST", body: { internalReason: REASON } }),
      );
      const decided = await h.prisma.shopChangeRequest.findUniqueOrThrow({ where: { id: request.id } });
      assert.equal(decided.status, "APPROVED");
      assert.ok(decided.decidedAt);
      assert.ok(decided.decidedAt.getTime() >= releasedAt - 5, "decidedAt is earlier than the lock release");
    });

    it("a decision or resubmission that waited for the shop lock is timestamped after the wait", async () => {
      const latestEvent = (shopId: string) =>
        h.prisma.shopStatusEvent.findFirstOrThrow({ where: { shopId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });

      const pending = await h.shopInStatus("PENDING");
      const decided = await lockedDuring(pending.shopId, () => decide(pending.shopId, "approve", { internalReason: REASON }));
      const decision = await latestEvent(pending.shopId);
      assert.equal(decision.toStatus, "APPROVED");
      assert.ok(decision.createdAt.getTime() >= decided - 5);

      const rejected = await h.shopInStatus("REJECTED");
      const resubmitted = await lockedDuring(rejected.shopId, () => h.call("/sellers/me/shop/resubmit", rejected.owner.token, { method: "POST" }));
      const resubmission = await latestEvent(rejected.shopId);
      assert.equal(resubmission.toStatus, "PENDING");
      assert.ok(resubmission.createdAt.getTime() >= resubmitted - 5);
    });

    it("every status change writes exactly one ShopStatusEvent with actor, reasons, note, and time", async () => {
      const customer = await h.actor();
      const { id } = (await (await create(customer)).json()) as OwnerShopResponse;
      await decide(id, "reject", { applicantReason: REJECTION, internalNote: "n1" });
      await h.call("/sellers/me/shop/resubmit", customer.token, { method: "POST" });
      await decide(id, "approve", { internalReason: REASON, internalNote: "n2" });
      await decide(id, "suspend", { internalReason: REASON });
      await decide(id, "reinstate", { internalReason: REASON, internalNote: "n3" });
      const events = await h.prisma.shopStatusEvent.findMany({ where: { shopId: id }, orderBy: { createdAt: "asc" } });
      assert.deepEqual(
        events.map((e) => [e.fromStatus, e.toStatus, e.decisionType, e.actorUserId === customer.userId ? "owner" : "admin", e.internalNote]),
        [
          [null, "PENDING", null, "owner", null],
          ["PENDING", "REJECTED", "APPLICATION_REJECTED", "admin", "n1"],
          ["REJECTED", "PENDING", null, "owner", null],
          ["PENDING", "APPROVED", "APPLICATION_APPROVED", "admin", "n2"],
          ["APPROVED", "SUSPENDED", "SUSPENDED", "admin", null],
          ["SUSPENDED", "APPROVED", "REINSTATED", "admin", "n3"],
        ],
      );
      // Administrators read the full history, including internal data.
      const detail = await (await h.call(`/admin/shops/${id}`, admin.token)).json();
      const keys = allKeys(detail);
      for (const key of ["internalReason", "internalNote", "actorUserId", "fieldChanges", "changeRequests"]) assert.ok(keys.has(key));
    });

    it("the database enforces the reason shape of audit events and the one-open-request rule", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await assert.rejects(
        h.prisma.shopStatusEvent.create({
          data: { shopId, toStatus: "REJECTED", fromStatus: "PENDING", actorUserId: admin.userId, decisionType: "APPLICATION_REJECTED", internalReason: REASON },
        }),
      );
      await assert.rejects(
        h.prisma.shopStatusEvent.create({
          data: { shopId, toStatus: "APPROVED", fromStatus: "PENDING", actorUserId: admin.userId, decisionType: "APPLICATION_APPROVED" },
        }),
      );
      await h.prisma.shopChangeRequest.create({ data: { shopId, proposedCity: "A", submittedByUserId: owner.userId } });
      await assert.rejects(h.prisma.shopChangeRequest.create({ data: { shopId, proposedCity: "B", submittedByUserId: owner.userId } }), {
        code: "P2002",
      });
    });

    it("the admin list filters by status and open change requests", async () => {
      const pending = await h.shopInStatus("PENDING");
      const approved = await h.shopInStatus("APPROVED");
      await h.call("/sellers/me/shop/change-requests", approved.owner.token, { method: "POST", body: { city: "Rosso" } });
      const listed = async (query: string) => {
        const list = (await (await h.call(`/admin/shops${query}`, admin.token)).json()) as {
          shops: { id: string; hasOpenChangeRequest: boolean }[];
        };
        return list.shops.map((s) => [s.id, s.hasOpenChangeRequest]);
      };
      assert.deepEqual(await listed("?openChangeRequest=true"), [[approved.shopId, true]]);
      assert.deepEqual(await listed("?openChangeRequest=false"), [[pending.shopId, false]]);
      assert.equal((await listed("")).length, 2);
      assert.equal((await h.call("/admin/shops?status=NOPE", admin.token)).status, 400);
      assert.equal((await h.call("/admin/shops?unknown=1", admin.token)).status, 400);
    });
  });
});
