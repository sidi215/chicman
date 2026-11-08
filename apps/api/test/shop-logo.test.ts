import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import dotenv from "dotenv";
import sharp from "sharp";

import { runLogoCleanup } from "../src/modules/shops/index.js";
import { ShopHarness, MEDIA_BASE_URL, TEST_TIMING, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

const image = (width: number, height: number, format: "png" | "jpeg" | "webp") =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } })
    .toFormat(format)
    .toBuffer();

const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
const HTML = Buffer.from("<!doctype html><html><body><script>alert(1)</script></body></html>");

describe("shop logo upload (spec 06, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let png: Buffer;

  before(async () => {
    await h.start();
    png = await image(120, 80, "png");
  });
  after(() => h.stop());
  beforeEach(() => h.reset());

  interface Upload {
    uploadId: string;
    stagingKey: string;
  }

  async function requestUpload(owner: Actor, contentType = "image/png", contentLength = 1000): Promise<Upload> {
    const res = await h.call("/sellers/me/shop/logo/uploads", owner.token, { method: "POST", body: { contentType, contentLength } });
    assert.equal(res.status, 201);
    const body = (await res.json()) as { uploadId: string };
    const row = await h.prisma.shopLogoUpload.findUniqueOrThrow({ where: { id: body.uploadId } });
    return { uploadId: body.uploadId, stagingKey: row.stagingKey };
  }

  const complete = (owner: Actor, uploadId: string) =>
    h.call(`/sellers/me/shop/logo/uploads/${uploadId}/complete`, owner.token, { method: "POST" });
  const cleanup = () => runLogoCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING, mediaPublicBaseUrl: MEDIA_BASE_URL });
  const shopOf = (shopId: string) => h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } });
  const uploadOf = (uploadId: string) => h.prisma.shopLogoUpload.findUniqueOrThrow({ where: { id: uploadId } });
  const objectsOf = (shopId: string) => h.prisma.shopLogoObject.findMany({ where: { shopId }, orderBy: { createdAt: "asc" } });
  /** Uploads a valid logo end to end; returns its logoUrl. */
  async function uploadLogo(owner: Actor, bytes: Buffer = png): Promise<string> {
    const upload = await requestUpload(owner, "image/png", bytes.byteLength);
    h.storage.staging.set(upload.stagingKey, bytes);
    const res = await complete(owner, upload.uploadId);
    assert.equal(res.status, 200);
    return ((await res.json()) as { logoUrl: string }).logoUrl;
  }

  describe("request", () => {
    it("refuses unsupported types (including SVG), oversize declarations, and unknown fields → 400", async () => {
      const { owner } = await h.shopInStatus("PENDING");
      for (const body of [
        { contentType: "image/svg+xml", contentLength: 100 },
        { contentType: "image/gif", contentLength: 100 },
        { contentType: "text/html", contentLength: 100 },
        { contentType: "image/png", contentLength: 15_728_641 },
        { contentType: "image/png", contentLength: 0 },
        { contentType: "image/png", contentLength: 1.5 },
        { contentType: "image/png", contentLength: 100, key: "shop-logos/other/x" },
        { contentType: "image/png" },
      ]) {
        const res = await h.call("/sellers/me/shop/logo/uploads", owner.token, { method: "POST", body });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
      assert.equal(await h.prisma.shopLogoUpload.count(), 0);
    });

    it("returns a 5-minute presigned PUT for a server-generated key under the shop's prefix", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const res = await h.call("/sellers/me/shop/logo/uploads", owner.token, {
        method: "POST",
        body: { contentType: "image/webp", contentLength: 15_728_640 },
      });
      assert.equal(res.status, 201);
      const body = (await res.json()) as { uploadId: string; method: string; headers: Record<string, string>; expiresAt: string; uploadUrl: string };
      assert.equal(body.method, "PUT");
      assert.deepEqual(body.headers, { "Content-Type": "image/webp", "Content-Length": "15728640" });
      const presigned = h.storage.presigned.at(-1);
      assert.equal(presigned?.key, `shop-logos/${shopId}/${body.uploadId}`);
      assert.equal(presigned?.expiresIn, 300);
      const row = await h.prisma.shopLogoUpload.findUniqueOrThrow({ where: { id: body.uploadId } });
      assert.equal(row.status, "PENDING");
      assert.equal(row.expiresAt.toISOString(), body.expiresAt);
      const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
      assert.ok(Math.abs(ttl - 300_000) < 1000);
      assert.equal(row.completeBy.getTime() - row.expiresAt.getTime(), TEST_TIMING.completionWindowMs);
    });

    it("is rate-limited per shop", async () => {
      const { owner } = await h.shopInStatus("PENDING");
      const statuses: number[] = [];
      for (let i = 0; i < 11; i += 1) {
        const res = await h.call("/sellers/me/shop/logo/uploads", owner.token, { method: "POST", body: { contentType: "image/png", contentLength: 10 } });
        statuses.push(res.status);
      }
      assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
      assert.equal(statuses[10], 429);
    });
  });

  describe("completion", () => {
    it("a valid logo is copied to the media bucket, referenced by its public URL, and audited", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner, "image/png", png.byteLength);
      h.storage.staging.set(upload.stagingKey, png);
      const res = await complete(owner, upload.uploadId);
      assert.equal(res.status, 200);
      const { logoUrl } = (await res.json()) as { logoUrl: string };
      const [object] = await objectsOf(shopId);
      assert.equal(object?.status, "ACTIVE");
      assert.match(object?.objectKey ?? "", new RegExp(`^shop-logos/${shopId}/${upload.uploadId}/[0-9a-f-]{36}\\.png$`));
      assert.equal(logoUrl, `${MEDIA_BASE_URL}/${object?.objectKey}`);
      assert.ok(!logoUrl.includes("X-Amz") && !logoUrl.includes("staging"));
      const media = h.storage.media.get(object?.objectKey ?? "");
      assert.ok(media);
      const stored = await sharp(media.body).metadata();
      assert.deepEqual([stored.format, stored.width, stored.height], ["png", 120, 80]);
      assert.equal(media?.contentType, "image/png");
      assert.equal((await shopOf(shopId)).logoUrl, logoUrl);
      const events = await h.prisma.shopFieldChangeEvent.findMany({ where: { shopId } });
      assert.deepEqual(
        events.map((e) => [e.field, e.source, e.oldValue, e.newValue, e.actorUserId]),
        [["logoUrl", "LOGO_UPLOAD", null, logoUrl, owner.userId]],
      );
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "COMPLETED");
      assert.equal(row.resultObjectId, object?.id);
      // Staging cleanup happens after the response.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(h.storage.staging.has(upload.stagingKey), false);
      assert.ok((await uploadOf(upload.uploadId)).stagingDeletedAt);
    });

    it("content that is not JPEG/PNG/WebP, or does not match the declared type → 422, logoUrl unchanged", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      for (const [declared, bytes] of [
        ["image/png", SVG],
        ["image/png", HTML],
        ["image/jpeg", png],
      ] as const) {
        const upload = await requestUpload(owner, declared, bytes.byteLength);
        h.storage.staging.set(upload.stagingKey, bytes);
        const res = await complete(owner, upload.uploadId);
        assert.equal(res.status, 422);
        assert.deepEqual(await res.json(), { error: { code: "LOGO_UNSUPPORTED_TYPE" } });
        const row = await uploadOf(upload.uploadId);
        assert.equal(row.status, "REJECTED");
        assert.equal(row.rejectionCode, "LOGO_UNSUPPORTED_TYPE");
        // A rejected upload stays rejected.
        const again = await complete(owner, upload.uploadId);
        assert.equal(again.status, 422);
      }
      assert.equal((await shopOf(shopId)).logoUrl, null);
      assert.equal(h.storage.media.size, 0);
      assert.equal(await h.prisma.shopLogoObject.count(), 0);
    });

    it("an actual file over 15 MB, too many pixels, or an undecodable image → 422, logoUrl unchanged", async () => {
      const { owner, shopId } = await h.shopInStatus("REJECTED");
      const cases: [Buffer, string][] = [
        [Buffer.concat([png, Buffer.alloc(15_728_640)]), "LOGO_TOO_LARGE"],
        [await image(8001, 8000, "png"), "LOGO_TOO_LARGE_DIMENSIONS"],
        [png.subarray(0, 70), "LOGO_INVALID_IMAGE"],
      ];
      for (const [bytes, code] of cases) {
        const upload = await requestUpload(owner, "image/png", 1000);
        h.storage.staging.set(upload.stagingKey, bytes);
        const res = await complete(owner, upload.uploadId);
        assert.equal(res.status, 422);
        assert.deepEqual(await res.json(), { error: { code } });
      }
      assert.equal((await shopOf(shopId)).logoUrl, null);
    });

    it("completing before uploading → 422 LOGO_NOT_UPLOADED and stays retryable; another shop's upload → 404; after completeBy → 410", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      const early = await complete(owner, upload.uploadId);
      assert.equal(early.status, 422);
      assert.deepEqual(await early.json(), { error: { code: "LOGO_NOT_UPLOADED" } });
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "PENDING");
      assert.equal(row.lastErrorCode, "LOGO_NOT_UPLOADED");

      const other = await h.shopInStatus("PENDING");
      assert.equal((await complete(other.owner, upload.uploadId)).status, 404);
      assert.equal((await complete(owner, randomUUID())).status, 404);
      assert.equal((await complete(owner, "not-a-uuid")).status, 404);

      h.storage.staging.set(upload.stagingKey, png);
      assert.equal((await complete(owner, upload.uploadId)).status, 200);

      const late = await requestUpload(owner);
      h.storage.staging.set(late.stagingKey, png);
      await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "completeBy" = now() - interval '1 second' WHERE "id" = ${late.uploadId}::uuid`;
      const expired = await complete(owner, late.uploadId);
      assert.equal(expired.status, 410);
      assert.deepEqual(await expired.json(), { error: { code: "LOGO_UPLOAD_EXPIRED" } });
      assert.equal((await objectsOf(shopId)).length, 1);
    });

    it("repeating completion of a COMPLETED upload returns the same logoUrl and creates nothing", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      const first = (await (await complete(owner, upload.uploadId)).json()) as { logoUrl: string };
      const before = { objects: await h.prisma.shopLogoObject.count(), events: await h.prisma.shopFieldChangeEvent.count(), row: await uploadOf(upload.uploadId) };
      const second = await complete(owner, upload.uploadId);
      assert.equal(second.status, 200);
      assert.deepEqual(await second.json(), first);
      assert.equal(await h.prisma.shopLogoObject.count(), before.objects);
      assert.equal(await h.prisma.shopFieldChangeEvent.count(), before.events);
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.attempt, before.row.attempt);
      assert.equal(row.updatedAt.getTime(), before.row.updatedAt.getTime());
      assert.equal(h.storage.media.size, 1);
      assert.equal((await shopOf(shopId)).logoUrl, first.logoUrl);
    });

    it("concurrent completions: exactly one claims; the others get 409 (or 200 once completed); one ACTIVE object", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.afterClaim = () => new Promise((resolve) => setTimeout(resolve, 150));
      const results = await Promise.all(Array.from({ length: 4 }, () => complete(owner, upload.uploadId)));
      const statuses = results.map((r) => r.status);
      assert.equal(statuses.filter((s) => s === 200).length >= 1, true);
      assert.ok(statuses.every((s) => s === 200 || s === 409), String(statuses));
      const objects = await objectsOf(shopId);
      assert.equal(objects.length, 1);
      assert.equal(objects[0]?.status, "ACTIVE");
      assert.equal((await uploadOf(upload.uploadId)).attempt, 1);
    });

    it("replacing an ACTIVE logo releases the previous object first; the old one is then deleted by the job", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const first = await uploadLogo(owner);
      const second = await uploadLogo(owner, await image(60, 60, "png"));
      assert.notEqual(first, second);
      const objects = await objectsOf(shopId);
      assert.deepEqual(
        objects.map((o) => o.status),
        ["RELEASED", "ACTIVE"],
      );
      assert.equal((await shopOf(shopId)).logoUrl, second);
      const result = await cleanup();
      assert.equal(result.deletedObjects, 1);
      assert.deepEqual(
        (await objectsOf(shopId)).map((o) => o.status),
        ["DELETED", "ACTIVE"],
      );
      assert.equal(h.storage.media.size, 1);
    });

    it("a failure after the release rolls back: the previous logo stays ACTIVE and referenced", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const first = await uploadLogo(owner);
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.afterReleasePrevious = () => {
        throw new Error("injected");
      };
      const res = await complete(owner, upload.uploadId);
      assert.equal(res.status, 503);
      delete h.faults.logo.afterReleasePrevious;
      assert.equal((await shopOf(shopId)).logoUrl, first);
      const objects = await objectsOf(shopId);
      assert.equal(objects[0]?.status, "ACTIVE");
      assert.equal(objects[1]?.status, "DELETED");
      assert.equal((await uploadOf(upload.uploadId)).status, "PENDING");
      // The retry succeeds with a new key.
      const retry = await complete(owner, upload.uploadId);
      assert.equal(retry.status, 200);
      const keys = (await objectsOf(shopId)).map((o) => o.objectKey);
      assert.equal(new Set(keys).size, 3);
    });

    it("removing the logo (PATCH logoUrl: null) releases the object, which the job deletes", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      await uploadLogo(owner);
      const res = await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { logoUrl: null } });
      assert.equal(res.status, 200);
      assert.equal((await shopOf(shopId)).logoUrl, null);
      assert.equal((await objectsOf(shopId))[0]?.status, "RELEASED");
      const event = await h.prisma.shopFieldChangeEvent.findFirstOrThrow({ where: { shopId, source: "OWNER_UPDATE" } });
      assert.equal(event.newValue, null);
      await cleanup();
      assert.equal((await objectsOf(shopId))[0]?.status, "DELETED");
      assert.equal(h.storage.media.size, 0);
      assert.equal(
        (await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { logoUrl: "https://evil.example/x.png" } })).status,
        400,
      );
    });
  });

  describe("failure injection and recovery", () => {
    it("A: public write failure → 503, logoUrl unchanged, upload retryable, object RELEASED; the retry uses a new key", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.storage.failPutMediaAfterWrite = true;
      const res = await complete(owner, upload.uploadId);
      assert.equal(res.status, 503);
      assert.deepEqual(await res.json(), { error: { code: "LOGO_STORAGE_UNAVAILABLE" } });
      assert.equal((await shopOf(shopId)).logoUrl, null);
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "PENDING");
      assert.equal(row.lastErrorCode, "LOGO_STORAGE_UNAVAILABLE");
      const [failed] = await objectsOf(shopId);
      assert.equal(failed?.status, "RELEASED");
      // The timeout wrote the object; reconciliation deletes it.
      h.storage.failPutMediaAfterWrite = false;
      assert.equal((await complete(owner, upload.uploadId)).status, 200);
      await cleanup();
      const objects = await objectsOf(shopId);
      assert.deepEqual(
        objects.map((o) => o.status),
        ["DELETED", "ACTIVE"],
      );
      assert.notEqual(objects[0]?.objectKey, objects[1]?.objectKey);
      assert.equal(h.storage.media.size, 1);
    });

    it("B: database failure after the write → 503, object not referenced, compensating delete → DELETED", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.beforeCommit = () => {
        throw new Error("database error");
      };
      const res = await complete(owner, upload.uploadId);
      assert.equal(res.status, 503);
      delete h.faults.logo.beforeCommit;
      assert.equal((await shopOf(shopId)).logoUrl, null);
      assert.equal((await objectsOf(shopId))[0]?.status, "DELETED");
      assert.equal(h.storage.media.size, 0);
      assert.equal((await uploadOf(upload.uploadId)).status, "PENDING");
    });

    it("B: a commit that succeeded but reported an error keeps the ACTIVE object's bytes", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.beforeCommit = async () => {
        const [object] = await objectsOf(shopId);
        assert.ok(object);
        await h.prisma.shopLogoObject.update({ where: { id: object.id }, data: { status: "ACTIVE" } });
        await h.prisma.shopLogoUpload.update({
          where: { id: upload.uploadId },
          data: { status: "COMPLETED", resultObjectId: object.id, completedAt: new Date(), leaseExpiresAt: null },
        });
        throw new Error("connection lost after the commit");
      };
      const res = await complete(owner, upload.uploadId);
      delete h.faults.logo.beforeCommit;
      assert.equal(res.status, 200);
      assert.equal((await objectsOf(shopId))[0]?.status, "ACTIVE");
      assert.equal(h.storage.media.size, 1);
      assert.deepEqual(h.storage.mediaDeletes, []);
    });

    it("C: a failed compensating delete leaves the object RELEASED; the reconciliation job deletes it later", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.beforeCommit = () => {
        throw new Error("database error");
      };
      h.storage.failDeleteMedia = true;
      assert.equal((await complete(owner, upload.uploadId)).status, 503);
      delete h.faults.logo.beforeCommit;
      let [object] = await objectsOf(shopId);
      assert.equal(object?.status, "RELEASED");
      assert.equal(object?.deleteAttempts, 1);
      // The job's own delete also fails: recorded, retried next run.
      const failedRun = await cleanup();
      assert.equal(failedRun.failedObjectDeletes, 1);
      [object] = await objectsOf(shopId);
      assert.equal(object?.status, "RELEASED");
      assert.equal(object?.deleteAttempts, 2);
      assert.ok(object?.lastDeleteError);
      h.storage.failDeleteMedia = false;
      await cleanup();
      assert.equal((await objectsOf(shopId))[0]?.status, "DELETED");
      assert.equal(h.storage.media.size, 0);
    });

    it("D: a stale attempt cannot commit; it releases only its own object and answers with the newer result", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      let newer: Response | undefined;
      h.faults.logo.beforeCommit = async (attempt) => {
        if (attempt !== 1) return;
        // Attempt 1 loses its lease; attempt 2 claims and completes.
        await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "id" = ${upload.uploadId}::uuid`;
        newer = await complete(owner, upload.uploadId);
      };
      const stale = await complete(owner, upload.uploadId);
      delete h.faults.logo.beforeCommit;
      assert.equal(newer?.status, 200);
      const newerBody = (await newer?.json()) as { logoUrl: string };
      assert.equal(stale.status, 200);
      assert.deepEqual(await stale.json(), newerBody);
      const objects = await objectsOf(shopId);
      assert.equal(objects.length, 2);
      const staleObject = objects.find((o) => o.attempt === 1);
      const activeObject = objects.find((o) => o.attempt === 2);
      assert.equal(staleObject?.status, "DELETED");
      assert.equal(activeObject?.status, "ACTIVE");
      assert.ok(h.storage.media.has(activeObject?.objectKey ?? ""));
      assert.equal(h.storage.media.has(staleObject?.objectKey ?? ""), false);
      assert.equal((await shopOf(shopId)).logoUrl, newerBody.logoUrl);
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "COMPLETED");
      assert.equal(row.resultObjectId, activeObject?.id);
    });

    it("a database error during a stale attempt never overwrites the newer COMPLETED upload", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.beforeCommit = async (attempt) => {
        if (attempt !== 1) return;
        await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "id" = ${upload.uploadId}::uuid`;
        assert.equal((await complete(owner, upload.uploadId)).status, 200);
        throw new Error("database error");
      };
      const res = await complete(owner, upload.uploadId);
      delete h.faults.logo.beforeCommit;
      assert.equal(res.status, 200);
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "COMPLETED");
      assert.equal(row.lastErrorCode, null);
      assert.equal((await objectsOf(shopId)).filter((o) => o.status === "ACTIVE").length, 1);
    });

    it("a late completion of an object reclaimed by the job rolls back and never activates it", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.beforeCommit = async () => {
        await h.prisma.$executeRaw`UPDATE "ShopLogoObject" SET "createdAt" = now() - interval '1 hour' WHERE "uploadId" = ${upload.uploadId}::uuid`;
        const run = await cleanup();
        assert.equal(run.reclaimedObjects, 1);
      };
      const res = await complete(owner, upload.uploadId);
      delete h.faults.logo.beforeCommit;
      assert.equal(res.status, 409);
      assert.equal((await shopOf(shopId)).logoUrl, null);
      const [object] = await objectsOf(shopId);
      assert.notEqual(object?.status, "ACTIVE");
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "PENDING");
      assert.equal(row.lastErrorCode, "LEASE_EXPIRED");
      // Retryable.
      assert.equal((await complete(owner, upload.uploadId)).status, 200);
    });

    it("a stale worker that wakes after the job reclaimed its upload changes nothing but its own object", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      h.faults.logo.beforeCommit = async () => {
        await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "id" = ${upload.uploadId}::uuid`;
        const run = await cleanup();
        assert.equal(run.reclaimedToPending, 1);
      };
      const res = await complete(owner, upload.uploadId);
      delete h.faults.logo.beforeCommit;
      assert.equal(res.status, 409);
      const row = await uploadOf(upload.uploadId);
      assert.equal(row.status, "PENDING");
      assert.equal(row.lastErrorCode, "LEASE_EXPIRED");
      assert.equal(row.attempt, 1);
      assert.equal((await objectsOf(shopId))[0]?.status, "DELETED");
      assert.equal((await shopOf(shopId)).logoUrl, null);
      // Its staging object was kept: the retry succeeds.
      assert.ok(h.storage.staging.has(upload.stagingKey));
      assert.equal((await complete(owner, upload.uploadId)).status, 200);
    });

    it("a suspended shop cannot complete a logo upload", async () => {
      const { owner, shopId } = await h.shopInStatus("APPROVED");
      const upload = await requestUpload(owner);
      h.storage.staging.set(upload.stagingKey, png);
      await h.prisma.shop.update({ where: { id: shopId }, data: { status: "SUSPENDED" } });
      assert.equal((await complete(owner, upload.uploadId)).status, 403);
      assert.equal((await uploadOf(upload.uploadId)).status, "PENDING");
    });
  });

  describe("cleanup and reconciliation", () => {
    it("abandoned PROCESSING uploads: before completeBy → PENDING (staging kept); after → EXPIRED (staging deleted)", async () => {
      const { owner } = await h.shopInStatus("PENDING");
      const early = await requestUpload(owner);
      const late = await requestUpload(owner);
      const live = await requestUpload(owner);
      for (const u of [early, late, live]) h.storage.staging.set(u.stagingKey, png);
      await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "status" = 'PROCESSING', "attempt" = 1, "leaseExpiresAt" = now() - interval '1 second' WHERE "id" IN (${early.uploadId}::uuid, ${late.uploadId}::uuid)`;
      await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "completeBy" = now() - interval '1 second' WHERE "id" = ${late.uploadId}::uuid`;
      await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "status" = 'PROCESSING', "attempt" = 1, "leaseExpiresAt" = now() + interval '1 minute' WHERE "id" = ${live.uploadId}::uuid`;

      const run = await cleanup();
      assert.equal(run.reclaimedToPending, 1);
      assert.equal(run.reclaimedToExpired, 1);
      const earlyRow = await uploadOf(early.uploadId);
      assert.equal(earlyRow.status, "PENDING");
      assert.equal(earlyRow.lastErrorCode, "LEASE_EXPIRED");
      assert.ok(h.storage.staging.has(early.stagingKey));
      assert.equal((await uploadOf(late.uploadId)).status, "EXPIRED");
      assert.equal(h.storage.staging.has(late.stagingKey), false);
      // A live lease is never touched.
      assert.equal((await uploadOf(live.uploadId)).status, "PROCESSING");
      assert.ok(h.storage.staging.has(live.stagingKey));
      // Safe to rerun.
      const rerun = await cleanup();
      assert.equal(rerun.reclaimedToPending + rerun.reclaimedToExpired + rerun.deletedStagingObjects, 0);
    });

    it("staging objects of completed, rejected, and expired uploads are deleted; failures are retried", async () => {
      const { owner } = await h.shopInStatus("PENDING");
      h.storage.failDeleteStaging = true;
      const done = await requestUpload(owner);
      h.storage.staging.set(done.stagingKey, png);
      assert.equal((await complete(owner, done.uploadId)).status, 200);
      const rejected = await requestUpload(owner);
      h.storage.staging.set(rejected.stagingKey, SVG);
      assert.equal((await complete(owner, rejected.uploadId)).status, 422);
      const expired = await requestUpload(owner);
      h.storage.staging.set(expired.stagingKey, png);
      await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "completeBy" = now() - interval '1 second' WHERE "id" = ${expired.uploadId}::uuid`;
      const pending = await requestUpload(owner);
      h.storage.staging.set(pending.stagingKey, png);

      const failed = await cleanup();
      assert.equal(failed.expiredUploads, 1);
      assert.equal(failed.failedStagingDeletes, 3);
      assert.equal(h.storage.staging.size, 4);

      h.storage.failDeleteStaging = false;
      const run = await cleanup();
      assert.equal(run.deletedStagingObjects, 3);
      assert.deepEqual([...h.storage.staging.keys()], [pending.stagingKey]);
      for (const u of [done, rejected, expired]) assert.ok((await uploadOf(u.uploadId)).stagingDeletedAt);
      assert.equal((await uploadOf(pending.uploadId)).stagingDeletedAt, null);
    });

    it("never deletes an ACTIVE object or any object referenced by Shop.logoUrl", async () => {
      const { owner, shopId } = await h.shopInStatus("PENDING");
      const logoUrl = await uploadLogo(owner);
      const [active] = await objectsOf(shopId);
      // A RELEASED row whose URL is still referenced (inconsistent state) is kept.
      await h.prisma.shopLogoObject.update({ where: { id: active?.id ?? "" }, data: { status: "RELEASED" } });
      await cleanup();
      assert.equal((await objectsOf(shopId))[0]?.status, "RELEASED");
      assert.ok(h.storage.media.has(active?.objectKey ?? ""));
      assert.equal((await shopOf(shopId)).logoUrl, logoUrl);
      await h.prisma.shopLogoObject.update({ where: { id: active?.id ?? "" }, data: { status: "ACTIVE" } });
      await cleanup();
      assert.ok(h.storage.media.has(active?.objectKey ?? ""));
      assert.equal(h.storage.mediaDeletes.length, 0);
    });
  });
});
