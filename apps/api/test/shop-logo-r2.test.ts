import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import { DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import sharp from "sharp";

import type { StorageConfig } from "../src/config/env.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { LogoService, runLogoCleanup, S3ObjectStorage, type LogoServiceFaults } from "../src/modules/shops/index.js";
import { resetDatabase, TEST_SHOP_FIELDS } from "./helpers/database.js";

dotenv.config({ quiet: true });

/**
 * The shop-logo flow against Cloudflare R2 itself (spec 06). Runs only with
 * R2_TEST_* variables; it never creates buckets or sets ACLs (R2 has none):
 * it uses existing buckets and writes only under keys of test shops it
 * creates, then deletes every object it wrote and resets the test database.
 *
 *   R2_TEST_ENDPOINT          https://<account-id>.r2.cloudflarestorage.com
 *   R2_TEST_ACCESS_KEY_ID / R2_TEST_SECRET_ACCESS_KEY
 *   R2_TEST_UPLOADS_BUCKET    private staging bucket (or a dedicated test bucket)
 *   R2_TEST_MEDIA_BUCKET      bucket with public access enabled in the dashboard
 *   R2_TEST_MEDIA_PUBLIC_BASE_URL  its public origin (r2.dev or custom domain)
 *   R2_TEST_CORS_ORIGIN       optional: browser origin expected in the staging CORS rule
 *
 * Credentials are never logged: assertions print statuses and key suffixes only.
 */
const env = (name: string) => process.env[name] ?? "";
const databaseUrl = process.env["TEST_DATABASE_URL"];
const required = [
  "R2_TEST_ENDPOINT",
  "R2_TEST_ACCESS_KEY_ID",
  "R2_TEST_SECRET_ACCESS_KEY",
  "R2_TEST_UPLOADS_BUCKET",
  "R2_TEST_MEDIA_BUCKET",
  "R2_TEST_MEDIA_PUBLIC_BASE_URL",
];
const missing = required.filter((name) => env(name) === "");
const skip = databaseUrl === undefined || missing.length > 0 ? `R2 verification needs TEST_DATABASE_URL and ${missing.join(", ")}` : false;

describe("shop logo upload against Cloudflare R2 (spec 06)", { skip }, () => {
  const config: StorageConfig = {
    endpoint: env("R2_TEST_ENDPOINT"),
    region: "auto",
    accessKeyId: env("R2_TEST_ACCESS_KEY_ID"),
    secretAccessKey: env("R2_TEST_SECRET_ACCESS_KEY"),
    uploadsBucket: env("R2_TEST_UPLOADS_BUCKET"),
    mediaBucket: env("R2_TEST_MEDIA_BUCKET"),
    mediaPublicBaseUrl: env("R2_TEST_MEDIA_PUBLIC_BASE_URL").replace(/\/+$/, ""),
  };
  const timing = { completionLeaseMs: 60_000, completionWindowMs: 900_000 };
  const faults: LogoServiceFaults = {};
  const shopIds: string[] = [];
  let prisma: PrismaClient;
  let storage: S3ObjectStorage;
  let logos: LogoService;
  let admin: S3Client;
  let png: Buffer;

  const exists = async (bucket: string, key: string) => {
    try {
      await admin.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  };
  const cleanup = () => runLogoCleanup({ prisma, storage, timing, mediaPublicBaseUrl: config.mediaPublicBaseUrl });

  async function ownerShop() {
    const user = await prisma.user.create({ data: { supabaseUserId: randomUUID(), roles: { create: [{ role: "CUSTOMER" }] } } });
    const shop = await prisma.shop.create({ data: { ownerUserId: user.id, ...TEST_SHOP_FIELDS } });
    shopIds.push(shop.id);
    return { userId: user.id, roles: ["CUSTOMER" as const], shopId: shop.id };
  }

  /** Requests an upload and PUTs `body` exactly like a browser would. */
  async function upload(owner: Awaited<ReturnType<typeof ownerShop>>, body: Buffer = png) {
    const requested = await logos.requestUpload(owner, { contentType: "image/png", contentLength: body.byteLength });
    const put = await fetch(requested.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body });
    return { requested, putStatus: put.status };
  }

  before(async () => {
    prisma = createPrismaClient(databaseUrl ?? "");
    await resetDatabase(prisma);
    admin = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    storage = new S3ObjectStorage(config);
    logos = new LogoService({ prisma, storage, timing, mediaPublicBaseUrl: config.mediaPublicBaseUrl, faults, log: () => undefined });
    png = await sharp({ create: { width: 96, height: 64, channels: 3, background: "#c0306a" } }).png().toBuffer();
  });

  beforeEach(() => {
    for (const key of Object.keys(faults)) delete faults[key as keyof LogoServiceFaults];
  });

  after(async () => {
    // Delete every object written under the test shops' prefixes, in both buckets.
    for (const bucket of [config.uploadsBucket, config.mediaBucket]) {
      for (const shopId of shopIds) {
        const listed = await admin.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `shop-logos/${shopId}/` }));
        for (const object of listed.Contents ?? []) await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
        const left = await admin.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `shop-logos/${shopId}/` }));
        assert.equal(left.KeyCount ?? 0, 0, "test objects left behind");
      }
    }
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  it("presigned PUT: 5 minutes, signed content-length and content-type, own key only; mismatches refused", async () => {
    const owner = await ownerShop();
    const requested = await logos.requestUpload(owner, { contentType: "image/png", contentLength: png.byteLength });
    const url = new URL(requested.uploadUrl);
    assert.equal(url.origin, new URL(config.endpoint).origin);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host");
    assert.equal(url.searchParams.get("x-amz-checksum-crc32"), null, "no flexible-checksum parameters");

    const wrongType = await fetch(requested.uploadUrl, { method: "PUT", headers: { "Content-Type": "text/html" }, body: png });
    assert.ok(wrongType.status === 403 || wrongType.status === 400, `wrong type → ${wrongType.status}`);
    const longer = Buffer.concat([png, Buffer.from("x")]);
    const wrongLength = await fetch(requested.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "Content-Length": String(longer.byteLength) },
      body: longer,
    });
    assert.ok(wrongLength.status === 403 || wrongLength.status === 400, `wrong length → ${wrongLength.status}`);
    const otherKey = await fetch(requested.uploadUrl.replace(requested.uploadId, randomUUID()), {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: png,
    });
    assert.ok(otherKey.status === 403 || otherKey.status === 400, `other key → ${otherKey.status}`);
    assert.equal(await exists(config.uploadsBucket, `shop-logos/${owner.shopId}/${requested.uploadId}`), false);

    const put = await fetch(requested.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/png" }, body: png });
    assert.equal(put.status, 200);
  });

  it("staging CORS allows the browser's PUT preflight (when an origin is given)", { skip: env("R2_TEST_CORS_ORIGIN") === "" ? "R2_TEST_CORS_ORIGIN not set" : false }, async () => {
    const owner = await ownerShop();
    const requested = await logos.requestUpload(owner, { contentType: "image/png", contentLength: png.byteLength });
    const preflight = await fetch(requested.uploadUrl, {
      method: "OPTIONS",
      headers: { Origin: env("R2_TEST_CORS_ORIGIN"), "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" },
    });
    assert.ok(preflight.status === 200 || preflight.status === 204, `preflight → ${preflight.status}`);
    assert.equal(preflight.headers.get("access-control-allow-origin"), env("R2_TEST_CORS_ORIGIN"));
  });

  it("verified logo is published to the public bucket; its permanent URL serves the image; staging is private and cleaned", async () => {
    const owner = await ownerShop();
    const { requested, putStatus } = await upload(owner);
    assert.equal(putStatus, 200);
    const stagingKey = `shop-logos/${owner.shopId}/${requested.uploadId}`;
    // The staging bucket has no public URL: an unsigned GET on the S3 endpoint is refused.
    const anonymous = await fetch(`${config.endpoint}/${config.uploadsBucket}/${stagingKey}`);
    assert.ok(anonymous.status >= 400, `anonymous staging GET → ${anonymous.status}`);

    const { logoUrl } = await logos.complete(owner, requested.uploadId);
    assert.ok(logoUrl.startsWith(`${config.mediaPublicBaseUrl}/shop-logos/${owner.shopId}/${requested.uploadId}/`));
    const media = await fetch(logoUrl);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    const served = Buffer.from(await media.arrayBuffer());
    const meta = await sharp(served).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ["png", 96, 64]);

    // Idempotent repeat.
    assert.deepEqual(await logos.complete(owner, requested.uploadId), { logoUrl });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await cleanup();
    assert.equal(await exists(config.uploadsBucket, stagingKey), false, "staging object deleted");
    assert.ok((await prisma.shopLogoUpload.findUniqueOrThrow({ where: { id: requested.uploadId } })).stagingDeletedAt);
  });

  it("only the normalized image becomes public on R2: a photo with GPS and device data, sideways and over 2 MB", async () => {
    const owner = await ownerShop();
    const photo = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 120, g: 120, b: 120 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .withExif({ IFD0: { Make: "SecretMake", Model: "SecretModel" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "18/1 5/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 92 })
      .toBuffer();
    assert.ok(photo.byteLength > 2_097_152 && photo.byteLength < 15_728_640, `fixture is ${photo.byteLength} bytes`);
    const requested = await logos.requestUpload(owner, { contentType: "image/jpeg", contentLength: photo.byteLength });
    const put = await fetch(requested.uploadUrl, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: photo });
    assert.equal(put.status, 200);
    const { logoUrl } = await logos.complete(owner, requested.uploadId);
    assert.ok(logoUrl.endsWith(".jpg"));
    const media = await fetch(logoUrl);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/jpeg");
    const served = Buffer.from(await media.arrayBuffer());
    const meta = await sharp(served).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height, meta.exif, meta.xmp, meta.iptc, meta.icc, meta.orientation], ["jpeg", 1024, 768, undefined, undefined, undefined, undefined, undefined]);
    assert.ok(served.byteLength <= 2_097_152);
    assert.ok(!served.includes("SecretModel") && !served.includes("SecretMake"));
  });

  it("content verification on R2: spoofed type, too many pixels, and a missing upload", async () => {
    const owner = await ownerShop();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const spoofed = await upload(owner, svg);
    assert.equal(spoofed.putStatus, 200);
    await assert.rejects(logos.complete(owner, spoofed.requested.uploadId), { status: 422, code: "LOGO_UNSUPPORTED_TYPE" });

    const wide = await sharp({ create: { width: 8001, height: 8000, channels: 3, background: "#000" } }).png().toBuffer();
    const big = await upload(owner, wide);
    await assert.rejects(logos.complete(owner, big.requested.uploadId), { status: 422, code: "LOGO_TOO_LARGE_DIMENSIONS" });

    const early = await logos.requestUpload(owner, { contentType: "image/png", contentLength: png.byteLength });
    await assert.rejects(logos.complete(owner, early.uploadId), { status: 422, code: "LOGO_NOT_UPLOADED" });
    assert.equal((await prisma.shop.findUniqueOrThrow({ where: { id: owner.shopId } })).logoUrl, null);

    // Capped staging read: an object over 2 MB is refused without buffering it.
    const hugeKey = `shop-logos/${owner.shopId}/${randomUUID()}`;
    await admin.send(new PutObjectCommand({ Bucket: config.uploadsBucket, Key: hugeKey, Body: Buffer.alloc(2_200_000) }));
    assert.equal((await storage.readStaging(hugeKey, 2_097_152)).kind, "tooLarge");
    assert.equal((await storage.readStaging(`${hugeKey}-missing`, 10)).kind, "missing");
    await storage.deleteStaging(hugeKey);
    await storage.deleteMedia(`shop-logos/${owner.shopId}/missing-${randomUUID()}.png`);
  });

  it("replacement releases the previous object; the worker job deletes it from R2", async () => {
    const owner = await ownerShop();
    const first = await upload(owner);
    const firstUrl = (await logos.complete(owner, first.requested.uploadId)).logoUrl;
    const second = await upload(owner, await sharp({ create: { width: 40, height: 40, channels: 3, background: "#123" } }).png().toBuffer());
    const secondUrl = (await logos.complete(owner, second.requested.uploadId)).logoUrl;
    assert.notEqual(firstUrl, secondUrl);
    const firstKey = firstUrl.slice(config.mediaPublicBaseUrl.length + 1);
    const secondKey = secondUrl.slice(config.mediaPublicBaseUrl.length + 1);

    const run = await cleanup();
    assert.equal(run.failedObjectDeletes, 0);
    assert.equal(await exists(config.mediaBucket, firstKey), false, "replaced object deleted from R2");
    assert.equal(await exists(config.mediaBucket, secondKey), true, "active object kept");
    const statuses = (await prisma.shopLogoObject.findMany({ where: { shopId: owner.shopId }, orderBy: { createdAt: "asc" } })).map((o) => o.status);
    assert.deepEqual(statuses, ["DELETED", "ACTIVE"]);
    assert.equal((await fetch(secondUrl)).status, 200);
  });

  it("failure recovery on R2: a database failure after the write deletes the new object; the retry publishes a new key", async () => {
    const owner = await ownerShop();
    const { requested } = await upload(owner);
    faults.beforeCommit = () => {
      throw new Error("injected database error");
    };
    await assert.rejects(logos.complete(owner, requested.uploadId), { status: 503 });
    delete faults.beforeCommit;
    const [failed] = await prisma.shopLogoObject.findMany({ where: { shopId: owner.shopId } });
    assert.equal(failed?.status, "DELETED");
    assert.equal(await exists(config.mediaBucket, failed?.objectKey ?? ""), false, "compensating delete reached R2");
    assert.equal((await prisma.shopLogoUpload.findUniqueOrThrow({ where: { id: requested.uploadId } })).status, "PENDING");

    const { logoUrl } = await logos.complete(owner, requested.uploadId);
    assert.ok(!logoUrl.endsWith(failed?.objectKey ?? "-"));
    assert.equal((await fetch(logoUrl)).status, 200);
  });

  it("a stale attempt cannot commit on R2 and removes only its own object", async () => {
    const owner = await ownerShop();
    const { requested } = await upload(owner);
    let newer = "";
    faults.beforeCommit = async (attempt) => {
      if (attempt !== 1) return;
      await prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "id" = ${requested.uploadId}::uuid`;
      newer = (await logos.complete(owner, requested.uploadId)).logoUrl;
    };
    const stale = await logos.complete(owner, requested.uploadId);
    assert.equal(stale.logoUrl, newer);
    const objects = await prisma.shopLogoObject.findMany({ where: { shopId: owner.shopId } });
    const staleObject = objects.find((o) => o.attempt === 1);
    const active = objects.find((o) => o.status === "ACTIVE");
    assert.equal(staleObject?.status, "DELETED");
    assert.equal(await exists(config.mediaBucket, staleObject?.objectKey ?? ""), false);
    assert.equal(await exists(config.mediaBucket, active?.objectKey ?? ""), true);
  });
});
