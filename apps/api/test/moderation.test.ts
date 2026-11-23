import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  expectedFigures,
  isValidReportReason,
  moderationResubmitSchema,
  moderationRestoreSchema,
  moderationSanctionSchema,
  productReportSchema,
  type AdminModerationCaseDetail,
  type AdminModerationCaseListResponse,
  type AdminProductDetail,
  type AdminProductListResponse,
  type AdminShopOrderListResponse,
  type Cart,
  type CatalogFacetsResponse,
  type CheckoutSummary,
  type FavoriteList,
  type NotificationList,
  type ProductModerationStatus,
  type PublicProductListResponse,
  type SellerProductDetail,
  type SellerProductListResponse,
  type SellerProductModerationResponse,
} from "@chicman/shared";
import dotenv from "dotenv";
import sharp from "sharp";

import { FallbackRateLimiter, MemoryRateLimiter, type RateLimiter } from "../src/lib/rate-limiter.js";
import { hiddenLineIssue } from "../src/modules/cart/cart-rules.js";
import { planAdminAction, type AdminProductAction } from "../src/modules/moderation/index.js";
import { recordProductModerationNotification } from "../src/modules/notifications/index.js";
import { moderationWriteError } from "../src/modules/products/product-lock.js";
import { PRODUCT_VISIBILITIES, productVisibility, type ProductVisibility } from "../src/modules/products/product-visibility.js";
import { ShopHarness, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const SANCTION = {
  sellerReasonCode: "MISLEADING_INFORMATION",
  sellerMessage: "La description ne correspond pas aux photos.",
  internalReason: "Signalements répétés, vérifié sur les photos.",
  internalNote: "Note interne de l'équipe.",
} as const;
const RESTORE = { internalReason: "Correction vérifiée par l'équipe.", sellerMessage: "Merci, votre produit est de nouveau visible." } as const;
const DISMISS = { internalReason: "Signalement non fondé après examen." } as const;

describe("product moderation contract (spec 19)", () => {
  it("plans every admin action from every state (section 3.2)", () => {
    const states: ProductModerationStatus[] = ["CLEAR", "RESTRICTED", "IN_REVIEW", "REMOVED"];
    const expected: Record<AdminProductAction, Record<ProductModerationStatus, string>> = {
      restrict: { CLEAR: "RESTRICTED", RESTRICTED: "repeat", IN_REVIEW: "409", REMOVED: "409" },
      "request-correction": { CLEAR: "RESTRICTED", RESTRICTED: "repeat", IN_REVIEW: "CORRECTION_REQUESTED", REMOVED: "409" },
      restore: { CLEAR: "409", RESTRICTED: "RESTORED", IN_REVIEW: "RESTORED", REMOVED: "409" },
      remove: { CLEAR: "REMOVED", RESTRICTED: "REMOVED", IN_REVIEW: "REMOVED", REMOVED: "repeat" },
    };
    for (const [action, row] of Object.entries(expected) as [AdminProductAction, Record<ProductModerationStatus, string>][]) {
      for (const from of states) {
        const plan = planAdminAction(action, from, false);
        const got = plan === null ? "409" : plan.kind === "repeat" ? "repeat" : plan.transition.action;
        assert.equal(got, row[from], `${action} from ${from}`);
      }
    }
    assert.equal(planAdminAction("restore", "CLEAR", true)?.kind, "repeat", "restoring right after a restoration is a repeat");
  });

  it("enforces the reasons of each action exactly", () => {
    assert.equal(moderationSanctionSchema.safeParse({ ...SANCTION, expectedStatus: "CLEAR" }).success, true);
    assert.equal(moderationSanctionSchema.safeParse(SANCTION).success, false, "the state acted on is required");
    for (const body of [
      { ...SANCTION, sellerReasonCode: "SPAM" },
      { ...SANCTION, sellerMessage: "court" },
      { ...SANCTION, sellerMessage: "x".repeat(1001) },
      { ...SANCTION, internalReason: "court" },
      { ...SANCTION, internalReason: "x".repeat(501) },
      { ...SANCTION, internalNote: "x".repeat(1001) },
      { sellerReasonCode: "OTHER", sellerMessage: SANCTION.sellerMessage },
      { ...SANCTION, actorUserId: randomUUID() },
    ]) {
      assert.equal(moderationSanctionSchema.safeParse({ expectedStatus: "CLEAR", ...body }).success, false, JSON.stringify(body).slice(0, 80));
    }
    assert.equal(moderationRestoreSchema.safeParse({ expectedStatus: "RESTRICTED", internalReason: RESTORE.internalReason }).success, true, "seller message optional");
    assert.equal(moderationRestoreSchema.safeParse({ expectedStatus: "RESTRICTED", sellerMessage: RESTORE.sellerMessage }).success, false, "internal reason required");
    assert.equal(moderationResubmitSchema.safeParse({}).success, true);
    assert.equal(moderationResubmitSchema.safeParse({ note: "x".repeat(501) }).success, false);
  });

  it("validates report reasons, with a description required for OTHER", () => {
    const productId = randomUUID();
    const parse = (body: unknown) => productReportSchema.parse(body);
    assert.equal(isValidReportReason(parse({ productId, reasonCode: "COUNTERFEIT" })), true);
    assert.equal(isValidReportReason(parse({ productId, reasonCode: "OTHER" })), false);
    assert.equal(isValidReportReason(parse({ productId, reasonCode: "OTHER", details: "Vendu d'occasion" })), true);
    assert.equal(isValidReportReason(parse({ productId, reasonCode: "INAPPROPRIATE_IMAGES" })), false, "a seller reason is not a report reason");
    assert.equal(productReportSchema.safeParse({ productId, reasonCode: "COUNTERFEIT", details: "x".repeat(1001) }).success, false);
    assert.equal(productReportSchema.safeParse({ productId, reasonCode: "COUNTERFEIT", reporterUserId: randomUUID() }).success, false);
  });

  it("handles every visibility value exhaustively (a missing case fails to compile)", () => {
    // The `Record` below must name every value: adding one without handling it is a type error.
    const handled: Record<Exclude<ProductVisibility, "PUBLIC">, string> = {
      MODERATED: hiddenLineIssue("MODERATED"),
      SHOP_NOT_APPROVED: hiddenLineIssue("SHOP_NOT_APPROVED"),
      ARCHIVED: hiddenLineIssue("ARCHIVED"),
      NOT_PUBLISHED: hiddenLineIssue("NOT_PUBLISHED"),
    };
    assert.deepEqual(Object.keys(handled).sort(), PRODUCT_VISIBILITIES.filter((value) => value !== "PUBLIC").sort());
    assert.equal(handled.MODERATED, "PRODUCT_UNPUBLISHED", "no new public issue code");
    const base = { status: "PUBLISHED", shopStatus: "APPROVED", hasActiveImage: true };
    for (const moderationStatus of ["RESTRICTED", "IN_REVIEW", "REMOVED"]) {
      assert.equal(productVisibility({ ...base, moderationStatus }), "MODERATED");
      assert.equal(productVisibility({ ...base, moderationStatus, shopStatus: "SUSPENDED" }), "MODERATED", "moderation wins");
    }
    assert.equal(productVisibility({ ...base, moderationStatus: "CLEAR" }), "PUBLIC");
  });

  it("allows every seller write while RESTRICTED, only stock while IN_REVIEW, nothing once REMOVED", () => {
    assert.equal(moderationWriteError("CLEAR", "content"), null);
    assert.equal(moderationWriteError("RESTRICTED", "content"), null);
    assert.equal(moderationWriteError("IN_REVIEW", "stock"), null);
    assert.equal(moderationWriteError("IN_REVIEW", "content")?.code, "PRODUCT_UNDER_REVIEW");
    assert.equal(moderationWriteError("REMOVED", "stock")?.code, "PRODUCT_REMOVED");
    assert.equal(moderationWriteError("REMOVED", "content")?.code, "PRODUCT_REMOVED");
  });
});

describe("product moderation (spec 19, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let seller: Actor;
  let shopId: string;
  let buyer: Actor;
  let admin: Actor;
  let tiny: Buffer;

  const sellerBase = "/sellers/me/products";
  const reportPath = "/customers/me/product-reports";

  before(async () => {
    await h.start();
    tiny = await sharp({ create: { width: 60, height: 80, channels: 3, background: { r: 10, g: 120, b: 90 } } })
      .png()
      .toBuffer();
  });
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner: seller, shopId } = await h.shopInStatus("APPROVED"));
    await h.prisma.shop.update({ where: { id: shopId }, data: { deliveryFee: "100.00" } });
    buyer = await h.actor("BUYER");
    admin = await h.actor("ADMIN");
  });

  const post = (path: string, actor: Actor | null, body?: unknown) => h.call(path, actor?.token ?? null, { method: "POST", body });
  /**
   * An admin action as the web page sends it: with the state the administrator
   * saw (`expectedStatus`), read here from the database unless the test sets it.
   */
  const adminAct = async (productId: string, action: AdminProductAction, body: object = action === "restore" ? RESTORE : SANCTION, actor: Actor = admin) => {
    const seen = (await h.prisma.product.findUnique({ where: { id: productId }, select: { moderationStatus: true } }))?.moderationStatus ?? "CLEAR";
    return post(`/admin/products/${productId}/moderation/${action}`, actor, { expectedStatus: seen, ...body });
  };
  const favoritesPut = (productId: string, actor: Actor = buyer) => h.call(`/customers/me/favorites/${productId}`, actor.token, { method: "PUT" });
  const report = (productId: string, actor: Actor = buyer, body: Record<string, unknown> = {}) =>
    post(reportPath, actor, { productId, reasonCode: "COUNTERFEIT", ...body });

  async function json<T>(response: Response, status = 200): Promise<T> {
    const text = await response.text();
    assert.equal(response.status, status, text);
    return JSON.parse(text) as T;
  }
  async function expectError(response: Response, status: number, code: string): Promise<void> {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { error: { code } });
  }

  async function uploadImage(actor: Actor, shop: string, productId: string): Promise<Response> {
    const upload = await post(`${sellerBase}/${productId}/images/uploads`, actor, { contentType: "image/png", contentLength: tiny.byteLength });
    if (upload.status !== 201) return upload;
    const { uploadId } = (await upload.json()) as { uploadId: string };
    h.storage.staging.set(`product-images/${shop}/${productId}/${uploadId}`, tiny);
    return post(`${sellerBase}/${productId}/images/uploads/${uploadId}/complete`, actor);
  }

  async function product(spec: { name?: string; publish?: boolean; actor?: Actor; shop?: string; size?: string } = {}): Promise<SellerProductDetail> {
    const actor = spec.actor ?? seller;
    const shop = spec.shop ?? shopId;
    const created = await post(sellerBase, actor, { name: spec.name ?? "Melhfa brodée", description: "Voile léger.", category: "CLOTHING", price: "1500.00", stock: 5 });
    const { id } = await json<SellerProductDetail>(created, 201);
    assert.equal((await uploadImage(actor, shop, id)).status, 200);
    if (spec.size !== undefined) assert.equal((await post(`${sellerBase}/${id}/variants`, actor, { size: spec.size, stock: 4 })).status, 201);
    if (spec.publish !== false) assert.equal((await post(`${sellerBase}/${id}/publish`, actor)).status, 200);
    return json<SellerProductDetail>(await h.call(`${sellerBase}/${id}`, actor.token));
  }

  const moderationOf = async (productId: string) =>
    (await h.prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { moderationStatus: true } })).moderationStatus;
  const events = (productId: string) => h.prisma.productModerationEvent.findMany({ where: { productId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const isPublic = async (productId: string) => (await h.call(`/products/${productId}`, null)).status === 200;
  const sellerNotifications = async (actor: Actor = seller) => json<NotificationList>(await h.call("/customers/me/notifications", actor.token));

  async function address(actor: Actor): Promise<string> {
    const row = await h.prisma.customerAddress.create({
      data: {
        userId: actor.userId,
        label: "Maison",
        city: "Nouakchott",
        district: "Tevragh Zeina",
        landmark: "Près de la mosquée",
        deliveryPhone: "+22233000000",
        latitude: "18.086000",
        longitude: "-15.975000",
        locationSource: "MANUAL",
        locationConfirmedAt: new Date(),
        isDefault: true,
      },
    });
    return row.id;
  }

  async function placementBody(actor: Actor) {
    const summary = await json<CheckoutSummary>(await h.call("/customers/me/checkout", actor.token));
    const expected = expectedFigures(summary);
    assert.ok(expected, JSON.stringify(summary.problems));
    return { addressId: summary.address?.addressId ?? "", recipientName: "Aïcha Mint Ahmed", expected };
  }

  async function orderFor(actor: Actor, productId: string): Promise<{ orderId: string; shopOrderId: string }> {
    assert.equal((await post("/customers/me/cart/items", actor, { productId, quantity: 1 })).status, 200);
    const placed = await h.call("/customers/me/checkout", actor.token, {
      method: "POST",
      body: await placementBody(actor),
      headers: { "Idempotency-Key": randomUUID() },
    });
    const order = await json<{ id: string; shopOrders: { id: string }[] }>(placed, 201);
    return { orderId: order.id, shopOrderId: order.shopOrders[0]?.id ?? "" };
  }

  describe("normal workflow", () => {
    it("report → OPEN case → dismiss: the product is unchanged and visible, both recorded", async () => {
      const item = await product();
      const receipt = await json<{ reportId: string; productId: string }>(await report(item.id), 201);
      assert.equal(receipt.productId, item.id);
      assert.equal(await isPublic(item.id), true, "a report never hides a product (PD-7)");

      const queue = await json<AdminModerationCaseListResponse>(await h.call("/admin/moderation/cases", admin.token));
      assert.equal(queue.total, 1);
      const open = queue.cases[0];
      assert.ok(open);
      assert.deepEqual([open.status, open.source, open.reportCount, open.productModerationStatus], ["OPEN", "REPORT", 1, "CLEAR"]);

      const detail = await json<AdminModerationCaseDetail>(await h.call(`/admin/moderation/cases/${open.id}`, admin.token));
      assert.deepEqual(
        detail.reports.map((r) => [r.reasonCode, r.reporterUserId]),
        [["COUNTERFEIT", buyer.userId]],
        "reporter account ID only (PD-10)",
      );
      assert.equal(detail.snapshot?.name, item.name);

      const dismissed = await json<AdminModerationCaseDetail>(await post(`/admin/moderation/cases/${open.id}/dismiss`, admin, DISMISS));
      assert.deepEqual([dismissed.case.status, dismissed.case.outcome], ["CLOSED", "DISMISSED"]);
      assert.equal(await moderationOf(item.id), "CLEAR");
      assert.equal(await isPublic(item.id), true);
      assert.deepEqual((await events(item.id)).map((e) => e.action), ["REPORTED", "DISMISSED"]);
      assert.equal((await sellerNotifications()).items.length, 0, "dismissal does not notify");

      // A repeat writes nothing; the queue is empty.
      assert.equal((await post(`/admin/moderation/cases/${open.id}/dismiss`, admin, DISMISS)).status, 200);
      assert.equal((await events(item.id)).length, 2);
      assert.equal((await json<AdminModerationCaseListResponse>(await h.call("/admin/moderation/cases", admin.token))).total, 0);
      // Closed cases can be searched.
      const closed = await json<AdminModerationCaseListResponse>(await h.call("/admin/moderation/cases?status=CLOSED&q=melhfa", admin.token));
      assert.equal(closed.total, 1);
    });

    it("inspect → restrict (hidden everywhere) → edit → resubmit → correction → resubmit → restore (visible)", async () => {
      const item = await product({ name: "Robe brodée", size: "XL" });
      const list = async () => json<PublicProductListResponse>(await h.call("/products", null));
      const facets = async () => json<CatalogFacetsResponse>(await h.call("/products/facets", null));
      const searchFallback = async () => json<PublicProductListResponse>(await h.call("/products?q=robe", null));
      assert.deepEqual((await list()).products.map((p) => p.id), [item.id]);
      assert.deepEqual((await facets()).sizes, ["XL"]);

      // Inspection: the admin product list shows every seller status.
      const listed = await json<AdminProductListResponse>(await h.call(`/admin/products?q=robe&shopId=${shopId}`, admin.token));
      assert.deepEqual(listed.products.map((p) => p.id), [item.id]);

      const restricted = await json<AdminProductDetail>(await adminAct(item.id, "restrict"));
      assert.equal(restricted.moderationStatus, "RESTRICTED");
      assert.equal(restricted.openCase?.status, "ACTIVE");
      assert.equal(restricted.openCase?.source, "ADMIN_INSPECTION");

      // Hidden everywhere: list, facets, details (404), search fallback.
      assert.equal((await list()).products.length, 0);
      assert.deepEqual((await facets()).sizes, []);
      assert.equal((await h.call(`/products/${item.id}`, null)).status, 404);
      assert.equal((await h.call(`/products/${item.id}`, null, { method: "HEAD" })).status, 404);
      assert.equal((await searchFallback()).products.length, 0);

      // Seller notified with the reason, and sees it on the product.
      const inbox = await sellerNotifications();
      assert.equal(inbox.items.length, 1);
      const note = inbox.items[0];
      assert.ok(note);
      assert.equal(note.type, "PRODUCT_RESTRICTED");
      assert.deepEqual(note.payload, { productId: item.id, productName: "Robe brodée", reasonCode: SANCTION.sellerReasonCode, sellerMessage: SANCTION.sellerMessage });
      assert.deepEqual(note.resource, { type: "PRODUCT", id: item.id });
      assert.equal(note.audience, "SELLER");
      const view = await json<SellerProductDetail>(await h.call(`${sellerBase}/${item.id}`, seller.token));
      assert.deepEqual([view.moderation.status, view.moderation.reasonCode, view.moderation.message], ["RESTRICTED", SANCTION.sellerReasonCode, SANCTION.sellerMessage]);

      // Correction while restricted, then resubmission.
      assert.equal((await h.call(`${sellerBase}/${item.id}`, seller.token, { method: "PATCH", body: { description: "Description corrigée." } })).status, 200);
      const resubmitted = await json<SellerProductModerationResponse>(await post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, { note: "Description corrigée" }));
      assert.equal(resubmitted.moderation.status, "IN_REVIEW");
      assert.equal(await isPublic(item.id), false);

      // IN_REVIEW products come first in the queue.
      const other = await product({ name: "Sac" });
      assert.equal((await report(other.id)).status, 201);
      const queue = await json<AdminModerationCaseListResponse>(await h.call("/admin/moderation/cases", admin.token));
      assert.deepEqual(queue.cases.map((c) => c.productId), [item.id, other.id]);

      const corrected = await json<AdminProductDetail>(await adminAct(item.id, "request-correction", { ...SANCTION, sellerReasonCode: "INAPPROPRIATE_IMAGES" }));
      assert.equal(corrected.moderationStatus, "RESTRICTED");
      assert.equal((await post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, {})).status, 200);
      const restored = await json<AdminProductDetail>(await adminAct(item.id, "restore"));
      assert.equal(restored.moderationStatus, "CLEAR");
      assert.equal(restored.openCase, null);
      assert.deepEqual(restored.priorCases.product, { total: 1, dismissed: 0, restored: 1, removed: 0 });

      assert.equal(await isPublic(item.id), true);
      assert.deepEqual((await list()).products.map((p) => p.id).sort(), [item.id, other.id].sort());
      assert.deepEqual((await facets()).sizes, ["XL"]);
      // One event per transition (acceptance 5): restrict, resubmit, correction, resubmit, restore.
      assert.deepEqual((await events(item.id)).map((e) => e.action), ["RESTRICTED", "RESUBMITTED", "CORRECTION_REQUESTED", "RESUBMITTED", "RESTORED"]);
      assert.deepEqual(
        (await sellerNotifications()).items.map((n) => n.type),
        ["PRODUCT_RESTORED", "PRODUCT_CORRECTION_REQUESTED", "PRODUCT_RESTRICTED"],
      );

      // The seller history: every round, administrators as "Chicman".
      const history = await json<SellerProductModerationResponse>(await h.call(`${sellerBase}/${item.id}/moderation`, seller.token));
      assert.deepEqual(
        history.history.map((entry) => [entry.action, entry.actor]),
        [
          ["RESTRICTED", "CHICMAN"],
          ["RESUBMITTED", "SELLER"],
          ["CORRECTION_REQUESTED", "CHICMAN"],
          ["RESUBMITTED", "SELLER"],
          ["RESTORED", "CHICMAN"],
        ],
      );
      // A repeat restore writes nothing; after it, edits go live without review (PD-6).
      assert.equal((await adminAct(item.id, "restore")).status, 200);
      assert.equal((await events(item.id)).length, 5);
      assert.equal((await h.call(`${sellerBase}/${item.id}`, seller.token, { method: "PATCH", body: { name: "Robe brodée main" } })).status, 200);
      assert.equal(await isPublic(item.id), true);
    });

    it("removes from CLEAR, RESTRICTED, and IN_REVIEW: terminal, seller writes refused, still readable", async () => {
      const fromClear = await product({ name: "A" });
      const fromRestricted = await product({ name: "B" });
      const fromReview = await product({ name: "C" });
      assert.equal((await adminAct(fromRestricted.id, "restrict")).status, 200);
      assert.equal((await adminAct(fromReview.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${fromReview.id}/moderation/resubmit`, seller, {})).status, 200);

      for (const item of [fromClear, fromRestricted, fromReview]) {
        const removed = await json<AdminProductDetail>(await adminAct(item.id, "remove"));
        assert.equal(removed.moderationStatus, "REMOVED");
        assert.equal(removed.openCase, null);
        assert.equal(await isPublic(item.id), false);

        await expectError(await h.call(`${sellerBase}/${item.id}`, seller.token, { method: "PATCH", body: { name: "Autre" } }), 409, "PRODUCT_REMOVED");
        await expectError(await h.call(`${sellerBase}/${item.id}/stock`, seller.token, { method: "PUT", body: { stock: 1, expectedStock: 5 } }), 409, "PRODUCT_REMOVED");
        await expectError(await post(`${sellerBase}/${item.id}/archive`, seller), 409, "PRODUCT_REMOVED");
        await expectError(await post(`${sellerBase}/${item.id}/images/uploads`, seller, { contentType: "image/png", contentLength: 10 }), 409, "PRODUCT_REMOVED");
        await expectError(await post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, {}), 409, "PRODUCT_MODERATION_CONFLICT");
        assert.equal((await h.call(`${sellerBase}/${item.id}`, seller.token)).status, 200, "the seller can still read it");

        // No way out (PD-9), by the API or the database.
        await expectError(await adminAct(item.id, "restore"), 409, "PRODUCT_MODERATION_CONFLICT");
        await expectError(await adminAct(item.id, "restrict"), 409, "PRODUCT_MODERATION_CONFLICT");
        assert.equal((await adminAct(item.id, "remove")).status, 200, "a repeat");
        await assert.rejects(h.prisma.product.update({ where: { id: item.id }, data: { moderationStatus: "CLEAR" } }));
        assert.equal(await moderationOf(item.id), "REMOVED");
      }
      assert.equal((await h.prisma.productModerationEvent.count({ where: { action: "REMOVED" } })), 3);
      const listed = await json<SellerProductListResponse>(await h.call(`${sellerBase}?moderationStatus=REMOVED`, seller.token));
      assert.equal(listed.total, 3);
    });

    it("a restored DRAFT product stays non-public until the seller publishes it", async () => {
      const item = await product({ publish: false });
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      assert.equal((await adminAct(item.id, "restore")).status, 200);
      assert.equal(await isPublic(item.id), false);
      assert.equal((await post(`${sellerBase}/${item.id}/publish`, seller)).status, 200);
      assert.equal(await isPublic(item.id), true);
    });
  });

  describe("unauthorized access", () => {
    it("lets only Buyers report: guest 401, Seller 403, Administrator 403", async () => {
      const item = await product();
      assert.equal((await report(item.id, null as unknown as Actor)).status, 401);
      await expectError(await report(item.id, seller), 403, "FORBIDDEN");
      await expectError(await report(item.id, admin), 403, "FORBIDDEN");
      assert.equal(await h.prisma.productReport.count(), 0);
    });

    it("refuses Buyers, Sellers, and deactivated administrators on every admin moderation route", async () => {
      const item = await product();
      const deactivated = await h.actor("ADMIN");
      await h.prisma.user.update({ where: { id: deactivated.userId }, data: { adminAccessDeactivatedAt: new Date() } });
      for (const actor of [buyer, seller, deactivated]) {
        await expectError(await h.call("/admin/products", actor.token), 403, "FORBIDDEN");
        await expectError(await h.call(`/admin/products/${item.id}`, actor.token), 403, "FORBIDDEN");
        await expectError(await adminAct(item.id, "restrict", SANCTION, actor), 403, "FORBIDDEN");
        await expectError(await h.call("/admin/moderation/cases", actor.token), 403, "FORBIDDEN");
      }
      assert.equal(await moderationOf(item.id), "CLEAR");
    });

    it("answers 404 to another seller on every seller moderation route", async () => {
      const item = await product();
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      const { owner: other } = await h.shopInStatus("APPROVED");
      await expectError(await h.call(`${sellerBase}/${item.id}/moderation`, other.token), 404, "PRODUCT_NOT_FOUND");
      await expectError(await post(`${sellerBase}/${item.id}/moderation/resubmit`, other, {}), 404, "PRODUCT_NOT_FOUND");
      await expectError(await h.call(`${sellerBase}/not-a-uuid/moderation`, seller.token), 404, "PRODUCT_NOT_FOUND");
    });

    it("never shows reports, reporters, internal reasons, notes, or administrators to the seller", async () => {
      const item = await product();
      assert.equal((await report(item.id, buyer, { reasonCode: "OTHER", details: "Texte privé du signalement" })).status, 201);
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, {})).status, 200);
      assert.equal((await adminAct(item.id, "request-correction")).status, 200);

      const bodies = [
        await (await h.call(`${sellerBase}/${item.id}`, seller.token)).text(),
        await (await h.call(sellerBase, seller.token)).text(),
        await (await h.call(`${sellerBase}/${item.id}/moderation`, seller.token)).text(),
        await (await h.call("/customers/me/notifications", seller.token)).text(),
      ];
      const caseId = (await h.prisma.productModerationCase.findFirstOrThrow({ where: { productId: item.id } })).id;
      for (const body of bodies) {
        for (const secret of [buyer.userId, admin.userId, "Texte privé du signalement", SANCTION.internalReason, SANCTION.internalNote, caseId, "REPORTED"]) {
          assert.equal(body.includes(secret), false, `seller response leaks ${secret}`);
        }
        assert.equal(body.includes(SANCTION.sellerMessage), true);
      }
    });

    it("refuses every action on an administrator's own shop (403), nothing written", async () => {
      const ownShop = await h.legacyShop("APPROVED", admin);
      const item = await product();
      await h.prisma.product.update({ where: { id: item.id }, data: { shopId: ownShop.shopId } });
      for (const action of ["restrict", "request-correction", "restore", "remove"] as const) {
        await expectError(await adminAct(item.id, action), 403, "SHOP_SELF_ADMINISTRATION_FORBIDDEN");
      }
      const detail = await json<AdminProductDetail>(await h.call(`/admin/products/${item.id}`, admin.token));
      assert.equal(detail.selfAdministered, true);
      assert.equal(await moderationOf(item.id), "CLEAR");
      assert.equal(await h.prisma.productModerationEvent.count(), 0);
    });
  });

  describe("duplicate reports and limits", () => {
    it("keeps one report per buyer while the case is open (200 on the repeat), and a new case after it closes", async () => {
      const item = await product();
      const first = await json<{ reportId: string }>(await report(item.id), 201);
      const again = await json<{ reportId: string }>(await report(item.id, buyer, { reasonCode: "NOT_NEW" }), 200);
      assert.equal(again.reportId, first.reportId);
      assert.equal(await h.prisma.productReport.count(), 1);
      const open = await h.prisma.productModerationCase.findFirstOrThrow({ where: { productId: item.id } });
      assert.equal(open.reportCount, 1);

      assert.equal((await post(`/admin/moderation/cases/${open.id}/dismiss`, admin, DISMISS)).status, 200);
      assert.equal((await report(item.id)).status, 201, "a new case after closure");
      assert.equal(await h.prisma.productModerationCase.count({ where: { productId: item.id } }), 2);
    });

    it("groups 10 concurrent reports into one case with reportCount = 10", async () => {
      const item = await product();
      const buyers = await Promise.all(Array.from({ length: 10 }, () => h.actor("BUYER")));
      const responses = await Promise.all(buyers.map((actor) => report(item.id, actor)));
      assert.deepEqual(responses.map((r) => r.status), Array(10).fill(201));
      const cases = await h.prisma.productModerationCase.findMany({ where: { productId: item.id } });
      assert.equal(cases.length, 1);
      assert.equal(cases[0]?.reportCount, 10);
      assert.equal(await h.prisma.productReport.count(), 10);
    });

    it("limits reports per user and per IP (429), including with the in-memory fallback", async () => {
      const items = await Promise.all(Array.from({ length: 11 }, (_, i) => product({ name: `Article ${i}` })));
      const failing: RateLimiter = {
        hit: async () => {
          throw new Error("redis down");
        },
      };
      for (const limiter of ["memory", "fallback"] as const) {
        await h.prisma.$transaction([
          h.prisma.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`),
          h.prisma.productModerationEvent.deleteMany(),
          h.prisma.productReport.deleteMany(),
          h.prisma.productModerationCase.deleteMany(),
        ]);
        h.reportRateLimiter = limiter === "fallback" ? new FallbackRateLimiter(failing, undefined, Date.now, () => undefined) : h.reportRateLimiter;
        const statuses: number[] = [];
        for (const item of items) statuses.push((await report(item.id)).status);
        assert.deepEqual(statuses, [...Array(10).fill(201), 429], `${limiter}: 10 per user`);

        // Per IP: 30 per window, whatever the account (every test request comes from one address).
        const others = await Promise.all(Array.from({ length: 20 }, () => h.actor("BUYER")));
        const more: number[] = [];
        for (const actor of others) more.push((await report(items[0]?.id ?? "", actor)).status);
        assert.equal(more.filter((s) => s === 429).length, 1, `${limiter}: the 31st request from the address`);
        h.reportRateLimiter = new MemoryRateLimiter();
      }
    });

    it("answers 404 for a product that is not public, and 400 for an invalid reason", async () => {
      const draft = await product({ publish: false });
      const restricted = await product();
      assert.equal((await adminAct(restricted.id, "restrict")).status, 200);
      await expectError(await report(draft.id), 404, "PRODUCT_NOT_FOUND");
      await expectError(await report(restricted.id), 404, "PRODUCT_NOT_FOUND");
      await expectError(await report(randomUUID()), 404, "PRODUCT_NOT_FOUND");

      const item = await product({ name: "Public" });
      await expectError(await report(item.id, buyer, { reasonCode: "SPAM" }), 400, "PRODUCT_REPORT_REASON_INVALID");
      await expectError(await report(item.id, buyer, { reasonCode: "OTHER" }), 400, "PRODUCT_REPORT_REASON_INVALID");
      await expectError(await report(item.id, buyer, { details: "x".repeat(1001) }), 400, "BAD_REQUEST");
      assert.equal(await h.prisma.productReport.count(), 0);
    });
  });

  describe("concurrent moderation", () => {
    it("two administrators restricting at once: one event and one notification", async () => {
      const item = await product();
      const second = await h.actor("ADMIN");
      const responses = await Promise.all([adminAct(item.id, "restrict"), adminAct(item.id, "restrict", SANCTION, second)]);
      for (const response of responses) assert.ok([200, 409].includes(response.status), String(response.status));
      assert.equal(await h.prisma.productModerationEvent.count({ where: { action: "RESTRICTED" } }), 1);
      assert.equal(await h.prisma.notification.count({ where: { type: "PRODUCT_RESTRICTED" } }), 1);
    });

    /** Requests sent at the same moment, both acting on the state the administrators saw. */
    const raceFrom = async (from: "RESTRICTED" | "IN_REVIEW", name: string) => {
      const item = await product({ name });
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      if (from === "IN_REVIEW") assert.equal((await post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, {})).status, 200);
      return item;
    };

    /** The committed outcome agrees everywhere: state, case, last event, notification. */
    async function assertConsistent(productId: string, winner: "restore" | "remove", from: string) {
      const expected = winner === "restore" ? { state: "CLEAR", action: "RESTORED", outcome: "RESTORED", type: "PRODUCT_RESTORED" } : { state: "REMOVED", action: "REMOVED", outcome: "REMOVED", type: "PRODUCT_REMOVED" };
      assert.equal(await moderationOf(productId), expected.state);
      const evs = await events(productId);
      const after = evs.filter((e) => e.action === "RESTORED" || e.action === "REMOVED");
      assert.deepEqual(after.map((e) => [e.action, e.fromStatus, e.toStatus]), [[expected.action, from, expected.state]], "exactly one transition recorded");
      const cases = await h.prisma.productModerationCase.findMany({ where: { productId } });
      assert.deepEqual(cases.map((c) => [c.status, c.outcome]), [["CLOSED", expected.outcome]]);
      const notes = await h.prisma.notification.findMany({ where: { type: { in: ["PRODUCT_RESTORED", "PRODUCT_REMOVED"] }, resourceId: productId } });
      assert.deepEqual(notes.map((n) => n.type), [expected.type]);
    }

    it("restore and remove sent concurrently on the same product: exactly one applies, the other gets 409 (20 races)", async () => {
      const winners = { restore: 0, remove: 0 };
      for (let round = 0; round < 20; round += 1) {
        const from = round % 2 === 0 ? "RESTRICTED" : "IN_REVIEW";
        const item = await raceFrom(from, `Course ${round}`);
        const restoreBody = { ...RESTORE, expectedStatus: from };
        const removeBody = { ...SANCTION, expectedStatus: from };
        // Fired together, without waiting for either answer.
        const [restore, remove] = await Promise.all([
          post(`/admin/products/${item.id}/moderation/restore`, admin, restoreBody),
          post(`/admin/products/${item.id}/moderation/remove`, admin, removeBody),
        ]);
        const statuses = [restore.status, remove.status].sort();
        assert.deepEqual(statuses, [200, 409], `round ${round}`);
        const loser = restore.status === 409 ? restore : remove;
        assert.deepEqual(await loser.json(), { error: { code: "PRODUCT_MODERATION_CONFLICT" } });
        const winner = restore.status === 200 ? "restore" : "remove";
        winners[winner] += 1;
        await assertConsistent(item.id, winner, from);
        if (winner === "remove") {
          // A removed product can never be restored afterwards, by the API or the database.
          await expectError(await adminAct(item.id, "restore"), 409, "PRODUCT_MODERATION_CONFLICT");
          await assert.rejects(h.prisma.product.update({ where: { id: item.id }, data: { moderationStatus: "CLEAR" } }));
        }
      }
      assert.equal(winners.restore + winners.remove, 20);
    });

    it("forced overlap in both orders: the second request waits on the product row lock, then is refused 409", async () => {
      for (const first of ["restore", "remove"] as const) {
        const item = await raceFrom("RESTRICTED", `Chevauchement ${first}`);
        const second = first === "restore" ? "remove" : "restore";
        const bodyFor = (action: "restore" | "remove") => ({ ...(action === "restore" ? RESTORE : SANCTION), expectedStatus: "RESTRICTED" });
        let started = false;
        let waitedOnLock = false;
        let later: Promise<Response> | undefined;
        h.faults.moderation.afterLocks = async () => {
          if (started) return;
          started = true;
          // The first transaction holds shop FOR SHARE, product FOR UPDATE, and the case.
          later = post(`/admin/products/${item.id}/moderation/${second}`, admin, bodyFor(second));
          for (let i = 0; i < 40 && !waitedOnLock; i += 1) {
            await delay(25);
            const rows = await h.prisma.$queryRaw<{ n: bigint }[]>`
              SELECT count(*) AS n FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%FROM "Product"%FOR UPDATE%'`;
            waitedOnLock = Number(rows[0]?.n ?? 0n) > 0;
          }
        };
        const winner = await post(`/admin/products/${item.id}/moderation/${first}`, admin, bodyFor(first));
        delete h.faults.moderation.afterLocks;
        const loser = await later;
        assert.equal(waitedOnLock, true, "the second transaction waited on the product row lock");
        assert.equal(winner.status, 200);
        assert.equal(loser?.status, 409);
        assert.deepEqual(await loser?.json(), { error: { code: "PRODUCT_MODERATION_CONFLICT" } });
        await assertConsistent(item.id, first, "RESTRICTED");
      }
    });

    it("an action on a state that changed before it is refused 409; a repeat of the same action is not (D4)", async () => {
      const item = await product();
      await expectError(await post(`/admin/products/${item.id}/moderation/restrict`, admin, { ...SANCTION, expectedStatus: "IN_REVIEW" }), 409, "PRODUCT_MODERATION_CONFLICT");
      await expectError(await post(`/admin/products/${item.id}/moderation/restrict`, admin, SANCTION), 400, "BAD_REQUEST");
      assert.equal(await h.prisma.productModerationEvent.count(), 0);
      assert.equal((await post(`/admin/products/${item.id}/moderation/restrict`, admin, { ...SANCTION, expectedStatus: "CLEAR" })).status, 200);
      // A second administrator who also saw CLEAR: the same action, already done → current state, nothing written.
      assert.equal((await post(`/admin/products/${item.id}/moderation/restrict`, admin, { ...SANCTION, expectedStatus: "CLEAR" })).status, 200);
      assert.equal(await h.prisma.productModerationEvent.count(), 1);
    });

    it("seller resubmit racing admin remove (both on RESTRICTED): exactly one applies", async () => {
      for (let round = 0; round < 10; round += 1) {
        const item = await raceFrom("RESTRICTED", `Resoumission ${round}`);
        const [resubmit, remove] = await Promise.all([
          post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, {}),
          post(`/admin/products/${item.id}/moderation/remove`, admin, { ...SANCTION, expectedStatus: "RESTRICTED" }),
        ]);
        assert.deepEqual([resubmit.status, remove.status].sort(), [200, 409], `round ${round}`);
        const last = (await events(item.id)).at(-1);
        if (remove.status === 200) {
          assert.equal(await moderationOf(item.id), "REMOVED");
          assert.deepEqual([last?.action, last?.fromStatus], ["REMOVED", "RESTRICTED"]);
        } else {
          assert.equal(await moderationOf(item.id), "IN_REVIEW");
          assert.deepEqual([last?.action, last?.fromStatus], ["RESUBMITTED", "RESTRICTED"]);
        }
      }
    });
  });

  describe("internal notes, reports, and history privacy", () => {
    const NOTE = "Note interne confidentielle 7c1f";
    const REASON = "Motif interne confidentiel 7c1f";
    const RESTORE_NOTE = "Note de rétablissement confidentielle 7c1f";
    const DISMISS_NOTE = "Note de classement confidentielle 7c1f";
    const REPORT_TEXT = "Texte de signalement privé 7c1f";
    const SECRETS = [NOTE, REASON, RESTORE_NOTE, DISMISS_NOTE, REPORT_TEXT, "7c1f"];

    async function bodies(actor: Actor, paths: string[]): Promise<{ path: string; text: string; status: number }[]> {
      const out = [];
      for (const path of paths) {
        const response = await h.call(path, actor.token);
        out.push({ path, text: await response.text(), status: response.status });
      }
      return out;
    }

    it("keeps internal reasons and notes to active administrators; the seller gets only the seller reason and message", async () => {
      const item = await product({ name: "Robe privée" });
      const dismissed = await product({ name: "Sac signalé" });
      // A buyer report on another product, dismissed with an internal note.
      assert.equal((await report(dismissed.id, buyer, { reasonCode: "OTHER", details: REPORT_TEXT })).status, 201);
      const openCase = await h.prisma.productModerationCase.findFirstOrThrow({ where: { productId: dismissed.id } });
      assert.equal((await post(`/admin/moderation/cases/${openCase.id}/dismiss`, admin, { internalReason: REASON, internalNote: DISMISS_NOTE })).status, 200);
      assert.equal(await h.prisma.productReport.count({ where: { productId: dismissed.id } }), 1, "the report is retained after dismissal");
      // Restrict and restore with internal reasons and notes.
      assert.equal((await adminAct(item.id, "restrict", { ...SANCTION, internalReason: REASON, internalNote: NOTE })).status, 200);
      assert.equal((await favoritesPut(item.id)).status, 404, "moderated: cannot be added");
      assert.equal((await adminAct(item.id, "restore", { internalReason: REASON, internalNote: RESTORE_NOTE, sellerMessage: RESTORE.sellerMessage })).status, 200);
      assert.equal((await adminAct(item.id, "restrict", { ...SANCTION, internalReason: REASON, internalNote: NOTE })).status, 200);

      // The seller: product, list, history, notifications (web and mobile scopes).
      const sellerViews = await bodies(seller, [
        `${sellerBase}/${item.id}`,
        sellerBase,
        `${sellerBase}/${item.id}/moderation`,
        `${sellerBase}/${dismissed.id}`,
        `${sellerBase}/${dismissed.id}/moderation`,
        "/customers/me/notifications",
        "/customers/me/notifications?audience=CUSTOMER",
      ]);
      for (const { path, text, status } of sellerViews) {
        assert.equal(status, 200, path);
        for (const secret of [...SECRETS, admin.userId, buyer.userId, openCase.id, "internalReason", "internalNote", "reporter"]) {
          assert.equal(text.includes(secret), false, `seller ${path} leaks ${secret}`);
        }
      }
      assert.ok(sellerViews[0]?.text.includes(SANCTION.sellerMessage), "the seller message is shown");
      // Dismissal shows nothing to the seller: no history, no reason, no notification about it.
      const dismissedHistory = JSON.parse(sellerViews[4]?.text ?? "{}") as SellerProductModerationResponse;
      assert.deepEqual(dismissedHistory.history, []);
      assert.deepEqual(dismissedHistory.moderation, { status: "CLEAR", reasonCode: null, message: null, updatedAt: null });
      const notes = await h.prisma.notification.findMany({ where: { userId: seller.userId } });
      for (const note of notes) assert.deepEqual(Object.keys(note.payload as object).sort(), ["productId", "productName", "reasonCode", "sellerMessage"]);
      assert.deepEqual(notes.map((n) => n.type).sort(), ["PRODUCT_RESTORED", "PRODUCT_RESTRICTED", "PRODUCT_RESTRICTED"]);

      // The buyer: public catalog, favorites, cart, their report receipt.
      const buyerViews = await bodies(buyer, [`/products/${dismissed.id}`, "/products", "/customers/me/favorites", "/customers/me/cart", "/customers/me/notifications"]);
      for (const { path, text } of buyerViews) {
        for (const secret of [...SECRETS, SANCTION.sellerMessage, "moderation", "RESTRICTED", "internalNote"]) {
          assert.equal(text.includes(secret), false, `buyer ${path} leaks ${secret}`);
        }
      }
      const receipt = await (await report(dismissed.id, buyer, { reasonCode: "COUNTERFEIT" })).json();
      assert.deepEqual(Object.keys(receipt as object).sort(), ["createdAt", "productId", "reasonCode", "reportId"]);

      // Only active administrators read them.
      const adminProduct = await json<AdminProductDetail>(await h.call(`/admin/products/${item.id}`, admin.token));
      assert.deepEqual(
        adminProduct.history.map((e) => [e.action, e.internalNote]),
        [["RESTRICTED", NOTE], ["RESTORED", RESTORE_NOTE], ["RESTRICTED", NOTE]],
      );
      const closedCase = await json<AdminModerationCaseDetail>(await h.call(`/admin/moderation/cases/${openCase.id}`, admin.token));
      assert.equal(closedCase.events.find((e) => e.action === "DISMISSED")?.internalNote, DISMISS_NOTE);
      assert.deepEqual(closedCase.reports.map((r) => [r.details, r.reporterUserId]), [[REPORT_TEXT, buyer.userId]]);
      const deactivated = await h.actor("ADMIN");
      await h.prisma.user.update({ where: { id: deactivated.userId }, data: { adminAccessDeactivatedAt: new Date() } });
      for (const actor of [buyer, seller, deactivated]) {
        for (const path of [`/admin/products/${item.id}`, `/admin/moderation/cases/${openCase.id}`, "/admin/moderation/cases?status=CLOSED"]) {
          const response = await h.call(path, actor.token);
          assert.equal(response.status, 403, path);
          const text = await response.text();
          for (const secret of SECRETS) assert.equal(text.includes(secret), false);
        }
      }
    });

    it("retains every report across cases, keeps one open case, and records each action once in the history", async () => {
      const item = await product();
      const second = await h.actor("BUYER");
      const third = await h.actor("BUYER");
      assert.equal((await report(item.id, buyer)).status, 201);
      assert.equal((await report(item.id, second, { reasonCode: "OTHER", details: REPORT_TEXT })).status, 201);
      assert.equal((await report(item.id, buyer)).status, 200, "a repeat while open writes nothing");
      const first = await h.prisma.productModerationCase.findFirstOrThrow({ where: { productId: item.id } });
      assert.equal(first.reportCount, 2);
      assert.equal((await post(`/admin/moderation/cases/${first.id}/dismiss`, admin, DISMISS)).status, 200);
      // After closure, reports open a new case; the old reports stay with the old case.
      assert.equal((await report(item.id, buyer)).status, 201);
      assert.equal((await report(item.id, third)).status, 201);
      const cases = await h.prisma.productModerationCase.findMany({ where: { productId: item.id }, orderBy: { openedAt: "asc" } });
      assert.deepEqual(cases.map((c) => [c.status, c.reportCount]), [["CLOSED", 2], ["OPEN", 2]]);
      assert.equal(await h.prisma.productModerationCase.count({ where: { productId: item.id, status: { not: "CLOSED" } } }), 1);
      assert.equal(await h.prisma.productReport.count({ where: { productId: item.id } }), 4, "every report retained");
      const history = await json<AdminProductDetail>(await h.call(`/admin/products/${item.id}`, admin.token));
      assert.deepEqual(history.history.map((e) => [e.action, e.actorType, e.actorUserId]), [
        ["REPORTED", "BUYER", buyer.userId],
        ["REPORTED", "BUYER", second.userId],
        ["DISMISSED", "ADMIN", admin.userId],
        ["REPORTED", "BUYER", buyer.userId],
        ["REPORTED", "BUYER", third.userId],
      ]);
      // Reports are immutable in the database.
      const row = await h.prisma.productReport.findFirstOrThrow({ where: { productId: item.id } });
      await assert.rejects(h.prisma.productReport.update({ where: { id: row.id }, data: { details: "modifié" } }));
      await assert.rejects(h.prisma.productReport.delete({ where: { id: row.id } }));
      await assert.rejects(h.prisma.productReport.deleteMany({ where: { productId: item.id } }));
      assert.equal(await h.prisma.productReport.count({ where: { productId: item.id } }), 4);
    });
  });

  describe("checkout, cart, and favorites", () => {
    it("never places an order after a restriction commits (checkout holding the lock completes first)", async () => {
      const item = await product();
      await address(buyer);
      assert.equal((await post("/customers/me/cart/items", buyer, { productId: item.id, quantity: 1 })).status, 200);
      const body = await placementBody(buyer);

      // Checkout first: it holds the product lock, the restriction waits for it.
      let restriction: Promise<Response> | undefined;
      h.faults.checkout.afterLocks = async () => {
        restriction = adminAct(item.id, "restrict");
        await delay(150);
      };
      const placed = await h.call("/customers/me/checkout", buyer.token, { method: "POST", body, headers: { "Idempotency-Key": randomUUID() } });
      delete h.faults.checkout.afterLocks;
      assert.equal(placed.status, 201);
      assert.equal((await restriction)?.status, 200);
      const order = await h.prisma.order.findFirstOrThrow({ select: { createdAt: true } });
      const restrictedAt = (await events(item.id))[0]?.createdAt;
      assert.ok(restrictedAt !== undefined && order.createdAt < restrictedAt);
    });

    it("refuses checkout (409, nothing written) once a restriction committed while it waited", async () => {
      const item = await product();
      await address(buyer);
      assert.equal((await post("/customers/me/cart/items", buyer, { productId: item.id, quantity: 1 })).status, 200);
      const body = await placementBody(buyer);

      // The restriction first: checkout waits for the product lock, then reads the restricted product.
      let checkout: Promise<Response> | undefined;
      h.faults.moderation.afterLocks = async () => {
        checkout = h.call("/customers/me/checkout", buyer.token, { method: "POST", body, headers: { "Idempotency-Key": randomUUID() } });
        await delay(150);
      };
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      delete h.faults.moderation.afterLocks;
      const refused = await checkout;
      assert.equal(refused?.status, 409);
      assert.equal(await h.prisma.order.count(), 0);
      assert.equal(await h.prisma.cartItem.count(), 1);
    });

    it("shows a moderated cart line as remove-only PRODUCT_UNPUBLISHED with no image; adding is 404", async () => {
      const item = await product();
      assert.equal((await post("/customers/me/cart/items", buyer, { productId: item.id, quantity: 1 })).status, 200);
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      const cart = await json<Cart>(await h.call("/customers/me/cart", buyer.token));
      const line = cart.shops[0]?.items[0];
      assert.ok(line);
      assert.deepEqual(line.issues, [{ code: "PRODUCT_UNPUBLISHED" }]);
      assert.equal(line.purchasable, false);
      assert.equal(line.imageUrl, null);
      await expectError(await post("/customers/me/cart/items", buyer, { productId: item.id, quantity: 1 }), 404, "PRODUCT_NOT_FOUND");
      // Removing still works.
      assert.equal((await h.call(`/customers/me/cart/items/${line.id}`, buyer.token, { method: "DELETE" })).status, 200);
    });

    it("shows a moderated favorite UNAVAILABLE with its name and no image, price, shop, or link; adding is 404", async () => {
      const item = await product({ name: "Sandales" });
      const other = await product({ name: "Voile" });
      assert.equal((await h.call(`/customers/me/favorites/${item.id}`, buyer.token, { method: "PUT" })).status, 200);
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      assert.equal((await adminAct(other.id, "restrict")).status, 200);
      const list = await json<FavoriteList>(await h.call("/customers/me/favorites", buyer.token));
      assert.deepEqual(list.items.map(({ name, state, imageUrl, product: summary }) => ({ name, state, imageUrl, summary })), [
        { name: "Sandales", state: "UNAVAILABLE", imageUrl: null, summary: null },
      ]);
      await expectError(await h.call(`/customers/me/favorites/${other.id}`, buyer.token, { method: "PUT" }), 404, "PRODUCT_NOT_FOUND");
      const text = JSON.stringify(list);
      for (const word of ["RESTRICTED", "MODERATED", "moderation"]) assert.equal(text.includes(word), false);
    });

    it("keeps orders, items, views, and stock identical through restriction and removal; orders still move", async () => {
      const item = await product();
      await address(buyer);
      const pending = await orderFor(buyer, item.id);
      const confirmed = await orderFor(buyer, item.id);
      const delivered = await orderFor(buyer, item.id);
      const cancelled = await orderFor(buyer, item.id);
      const sellerOrders = "/sellers/me/orders";
      for (const id of [confirmed.shopOrderId, delivered.shopOrderId]) assert.equal((await post(`${sellerOrders}/${id}/confirm`, seller, {})).status, 200);
      for (const step of ["ready", "dispatch"]) assert.equal((await post(`${sellerOrders}/${delivered.shopOrderId}/delivery/${step}`, seller, {})).status, 200);
      assert.equal((await post(`${sellerOrders}/${delivered.shopOrderId}/delivery/delivered`, seller, { amount: "1600.00" })).status, 200);
      assert.equal(
        (await post(`/customers/me/orders/${cancelled.orderId}/shop-orders/${cancelled.shopOrderId}/cancel`, buyer, { reason: "CHANGED_MIND" })).status,
        200,
      );

      const snapshot = async () => ({
        items: await h.prisma.orderItem.findMany({ orderBy: { id: "asc" } }),
        stock: (await h.prisma.product.findUniqueOrThrow({ where: { id: item.id } })).stock,
        movements: await h.prisma.stockMovement.count(),
        payments: await h.prisma.payment.findMany({ orderBy: { id: "asc" } }),
        deliveries: await h.prisma.delivery.findMany({ orderBy: { id: "asc" } }),
        customerViews: await Promise.all([pending, confirmed, delivered, cancelled].map(async ({ orderId }) => (await h.call(`/customers/me/orders/${orderId}`, buyer.token)).text())),
        sellerViews: await Promise.all([pending, confirmed, delivered, cancelled].map(async ({ shopOrderId }) => (await h.call(`${sellerOrders}/${shopOrderId}`, seller.token)).text())),
        adminViews: await Promise.all([pending, confirmed, delivered, cancelled].map(async ({ shopOrderId }) => (await h.call(`/admin/orders/${shopOrderId}`, admin.token)).text())),
      });
      const before = await snapshot();
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      assert.deepEqual(await snapshot(), before);
      assert.equal((await adminAct(item.id, "remove")).status, 200);
      assert.deepEqual(await snapshot(), before);

      // The case page lists the shop orders containing the product.
      const withProduct = await json<AdminShopOrderListResponse>(await h.call(`/admin/orders?productId=${item.id}`, admin.token));
      assert.equal(withProduct.total, 4);
      assert.equal((await json<AdminShopOrderListResponse>(await h.call(`/admin/orders?productId=${randomUUID()}`, admin.token))).total, 0);

      // Order transitions still work (PD-11).
      assert.equal((await post(`${sellerOrders}/${pending.shopOrderId}/confirm`, seller, {})).status, 200);
      assert.equal((await post(`${sellerOrders}/${confirmed.shopOrderId}/delivery/ready`, seller, {})).status, 200);
    });
  });

  describe("seller resubmission", () => {
    it("refuses resubmission from CLEAR, IN_REVIEW, REMOVED, an archived product, and a suspended shop", async () => {
      const clear = await product({ name: "Clair" });
      await expectError(await post(`${sellerBase}/${clear.id}/moderation/resubmit`, seller, {}), 409, "PRODUCT_MODERATION_CONFLICT");

      const review = await product({ name: "Révision" });
      assert.equal((await adminAct(review.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${review.id}/moderation/resubmit`, seller, {})).status, 200);
      await expectError(await post(`${sellerBase}/${review.id}/moderation/resubmit`, seller, {}), 409, "PRODUCT_MODERATION_CONFLICT");

      const removed = await product({ name: "Retiré" });
      assert.equal((await adminAct(removed.id, "remove")).status, 200);
      await expectError(await post(`${sellerBase}/${removed.id}/moderation/resubmit`, seller, {}), 409, "PRODUCT_MODERATION_CONFLICT");

      const archived = await product({ name: "Archivé" });
      assert.equal((await adminAct(archived.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${archived.id}/archive`, seller)).status, 200);
      await expectError(await post(`${sellerBase}/${archived.id}/moderation/resubmit`, seller, {}), 409, "PRODUCT_MODERATION_CONFLICT");

      const suspendedItem = await product({ name: "Suspendu" });
      assert.equal((await adminAct(suspendedItem.id, "restrict")).status, 200);
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      await expectError(await post(`${sellerBase}/${suspendedItem.id}/moderation/resubmit`, seller, {}), 403, "FORBIDDEN");
      // A suspended shop's seller still reads the moderation (any shop status).
      assert.equal((await h.call(`${sellerBase}/${suspendedItem.id}/moderation`, seller.token)).status, 200);
    });

    it("locks edits while IN_REVIEW except stock", async () => {
      const item = await product({ size: "M" });
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${item.id}/moderation/resubmit`, seller, {})).status, 200);
      const variantId = item.variants[0]?.id ?? (await h.prisma.productVariant.findFirstOrThrow({ where: { productId: item.id } })).id;

      await expectError(await h.call(`${sellerBase}/${item.id}`, seller.token, { method: "PATCH", body: { name: "Autre" } }), 409, "PRODUCT_UNDER_REVIEW");
      await expectError(await post(`${sellerBase}/${item.id}/variants`, seller, { size: "L" }), 409, "PRODUCT_UNDER_REVIEW");
      await expectError(await post(`${sellerBase}/${item.id}/archive`, seller), 409, "PRODUCT_UNDER_REVIEW");
      await expectError(await post(`${sellerBase}/${item.id}/images/uploads`, seller, { contentType: "image/png", contentLength: 10 }), 409, "PRODUCT_UNDER_REVIEW");
      const variant = await h.prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
      const stock = await h.call(`${sellerBase}/${item.id}/variants/${variantId}/stock`, seller.token, {
        method: "PUT",
        body: { stock: 9, expectedStock: variant.stock },
      });
      assert.equal(stock.status, 200, "stock updates are allowed (PD-5)");
    });

    it("allows publishing and restoring while RESTRICTED; the product stays hidden", async () => {
      const draft = await product({ publish: false, name: "Brouillon" });
      assert.equal((await adminAct(draft.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${draft.id}/publish`, seller)).status, 200);
      assert.equal(await isPublic(draft.id), false);

      const item = await product({ name: "Archivé puis restauré" });
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      assert.equal((await post(`${sellerBase}/${item.id}/archive`, seller)).status, 200);
      assert.equal((await post(`${sellerBase}/${item.id}/restore`, seller)).status, 200);
      assert.equal((await post(`${sellerBase}/${item.id}/publish`, seller)).status, 200);
      assert.equal(await isPublic(item.id), false);
      // A new image completes too.
      assert.equal((await uploadImage(seller, shopId, item.id)).status, 200);
    });
  });

  describe("notification failure", () => {
    it("rolls the whole action back when recording the notification fails", async () => {
      const item = await product();
      assert.equal((await report(item.id)).status, 201);
      h.faults.moderation.recordNotification = async () => {
        throw new Error("injected");
      };
      assert.equal((await adminAct(item.id, "restrict")).status, 500);
      delete h.faults.moderation.recordNotification;
      assert.equal(await moderationOf(item.id), "CLEAR");
      const open = await h.prisma.productModerationCase.findFirstOrThrow({ where: { productId: item.id } });
      assert.equal(open.status, "OPEN");
      assert.deepEqual((await events(item.id)).map((e) => e.action), ["REPORTED"]);
      assert.equal(await h.prisma.notification.count(), 0);
    });

    it("records a replayed event key once", async () => {
      const item = await product();
      const input = {
        sellerUserId: seller.userId,
        type: "PRODUCT_RESTRICTED" as const,
        eventId: randomUUID(),
        productId: item.id,
        productName: item.name,
        reasonCode: "OTHER" as const,
        sellerMessage: "Message pour le vendeur.",
      };
      await h.prisma.$transaction(async (tx) => {
        await recordProductModerationNotification(tx, input);
        await recordProductModerationNotification(tx, input);
      });
      await h.prisma.$transaction((tx) => recordProductModerationNotification(tx, input));
      assert.equal(await h.prisma.notification.count(), 1);
    });
  });

  describe("shops and audit", () => {
    it("lets administrators moderate a suspended shop's products; reinstatement never clears moderation", async () => {
      const item = await product();
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      const reinstated = await post(`/admin/shops/${shopId}/reinstate`, admin, { internalReason: "Réintégration après vérification." });
      assert.equal(reinstated.status, 200);
      assert.equal(await moderationOf(item.id), "RESTRICTED");
      assert.equal(await isPublic(item.id), false);
    });

    it("refuses UPDATE and DELETE on events and reports in the database", async () => {
      const item = await product();
      assert.equal((await report(item.id)).status, 201);
      const event = await h.prisma.productModerationEvent.findFirstOrThrow();
      const row = await h.prisma.productReport.findFirstOrThrow();
      await assert.rejects(h.prisma.productModerationEvent.update({ where: { id: event.id }, data: { internalReason: "réécrit après coup" } }));
      await assert.rejects(h.prisma.productModerationEvent.delete({ where: { id: event.id } }));
      await assert.rejects(h.prisma.productReport.update({ where: { id: row.id }, data: { details: "réécrit" } }));
      await assert.rejects(h.prisma.productReport.delete({ where: { id: row.id } }));
      // A report by a non-Buyer is refused by the database too (AT-1 style trigger).
      const caseId = row.caseId;
      await assert.rejects(h.prisma.productReport.create({ data: { caseId, productId: item.id, reporterUserId: seller.userId, reasonCode: "COUNTERFEIT" } }));
      // An event without the reasons its action requires is refused.
      await assert.rejects(
        h.prisma.productModerationEvent.create({
          data: { productId: item.id, caseId, action: "RESTRICTED", actorType: "ADMIN", actorUserId: admin.userId, contentSnapshot: {} },
        }),
      );
    });

    it("records actor, states, reasons, and an allowlisted snapshot on every event", async () => {
      const item = await product({ size: "S" });
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      const [event] = await events(item.id);
      assert.ok(event);
      assert.deepEqual(
        [event.actorType, event.actorUserId, event.fromStatus, event.toStatus, event.sellerReasonCode, event.internalReason, event.internalNote],
        ["ADMIN", admin.userId, "CLEAR", "RESTRICTED", SANCTION.sellerReasonCode, SANCTION.internalReason, SANCTION.internalNote],
      );
      const snapshot = event.contentSnapshot as Record<string, unknown>;
      assert.deepEqual(Object.keys(snapshot).sort(), ["brand", "category", "description", "imageKeys", "name", "price", "variants"]);
      assert.deepEqual(snapshot["variants"], [{ size: "S", color: null, stock: 4 }]);
      assert.equal((snapshot["imageKeys"] as string[]).length, 1);
    });

    it("refuses missing or out-of-range reasons with 400 and writes nothing", async () => {
      const item = await product();
      await expectError(await adminAct(item.id, "restrict", { ...SANCTION, sellerMessage: "court" }), 400, "BAD_REQUEST");
      await expectError(await adminAct(item.id, "remove", { sellerReasonCode: "OTHER", internalReason: SANCTION.internalReason }), 400, "BAD_REQUEST");
      await expectError(await adminAct(item.id, "restore", {}), 400, "BAD_REQUEST");
      await expectError(await adminAct(randomUUID(), "restrict"), 404, "PRODUCT_NOT_FOUND");
      await expectError(await h.call(`/admin/moderation/cases/${randomUUID()}`, admin.token), 404, "CASE_NOT_FOUND");
      assert.equal(await h.prisma.productModerationEvent.count(), 0);
      assert.equal(await moderationOf(item.id), "CLEAR");
    });

    it("hides seller moderation notifications from the mobile customer audience", async () => {
      const item = await product();
      assert.equal((await adminAct(item.id, "restrict")).status, 200);
      const customerOnly = await json<NotificationList>(await h.call("/customers/me/notifications?audience=CUSTOMER", seller.token));
      assert.equal(customerOnly.items.length, 0);
      assert.equal((await json<{ unread: number }>(await h.call("/customers/me/notifications/unread-count", seller.token))).unread, 1);
    });
  });
});
