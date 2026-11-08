import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import {
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutBucketAclCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv";
import sharp from "sharp";

import type { StorageConfig } from "../src/config/env.js";
import { createPrismaClient, type PrismaClient } from "../src/lib/prisma.js";
import { LogoService, runLogoCleanup, S3ObjectStorage } from "../src/modules/shops/index.js";
import { resetDatabase, TEST_SHOP_FIELDS } from "./helpers/database.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];
const endpoint = process.env["TEST_S3_ENDPOINT"];
const skip =
  databaseUrl === undefined || endpoint === undefined ? "TEST_DATABASE_URL and TEST_S3_ENDPOINT are required" : false;

/**
 * The logo flow against a real S3-compatible service (SeaweedFS locally;
 * the same code targets R2 by configuration). Uses its own test buckets.
 */
describe("shop logo upload against S3-compatible storage (spec 06)", { skip }, () => {
  const suffix = randomUUID().slice(0, 8);
  const config: StorageConfig = {
    endpoint: endpoint ?? "",
    region: process.env["TEST_S3_REGION"] ?? "us-east-1",
    accessKeyId: process.env["TEST_S3_ACCESS_KEY_ID"] ?? "",
    secretAccessKey: process.env["TEST_S3_SECRET_ACCESS_KEY"] ?? "",
    uploadsBucket: `chicman-test-uploads-${suffix}`,
    mediaBucket: `chicman-test-media-${suffix}`,
    mediaPublicBaseUrl: "",
  };
  config.mediaPublicBaseUrl = `${config.endpoint.replace(/\/+$/, "")}/${config.mediaBucket}`;
  const timing = { completionLeaseMs: 60_000, completionWindowMs: 900_000 };
  let prisma: PrismaClient;
  let storage: S3ObjectStorage;
  let logos: LogoService;
  let admin: S3Client;

  before(async () => {
    prisma = createPrismaClient(databaseUrl ?? "");
    await resetDatabase(prisma);
    admin = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
    await admin.send(new CreateBucketCommand({ Bucket: config.uploadsBucket }));
    await admin.send(new CreateBucketCommand({ Bucket: config.mediaBucket }));
    await admin.send(new PutBucketAclCommand({ Bucket: config.mediaBucket, ACL: "public-read" }));
    storage = new S3ObjectStorage(config);
    logos = new LogoService({ prisma, storage, timing, mediaPublicBaseUrl: config.mediaPublicBaseUrl, log: () => undefined });
  });

  after(async () => {
    for (const bucket of [config.uploadsBucket, config.mediaBucket]) {
      const listed = await admin.send(new ListObjectsV2Command({ Bucket: bucket }));
      for (const object of listed.Contents ?? []) await admin.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
      await admin.send(new DeleteBucketCommand({ Bucket: bucket }));
    }
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  async function ownerShop() {
    const user = await prisma.user.create({ data: { supabaseUserId: randomUUID(), roles: { create: [{ role: "CUSTOMER" }] } } });
    const shop = await prisma.shop.create({ data: { ownerUserId: user.id, ...TEST_SHOP_FIELDS } });
    return { userId: user.id, roles: ["CUSTOMER" as const], shopId: shop.id };
  }

  it("presigned PUT → verified completion → public media URL; staging stays private", async () => {
    const owner = await ownerShop();
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#c0306a" } }).png().toBuffer();
    const upload = await logos.requestUpload(owner, { contentType: "image/png", contentLength: png.byteLength });
    const url = new URL(upload.uploadUrl);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "content-length;content-type;host");
    assert.ok(url.pathname.endsWith(`/shop-logos/${owner.shopId}/${upload.uploadId}`));

    // A body whose type or length differs from the signed headers is refused.
    assert.equal((await fetch(upload.uploadUrl, { method: "PUT", headers: { "content-type": "text/html" }, body: png })).status, 403);
    assert.equal(
      (
        await fetch(upload.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "image/png", "Content-Length": String(png.byteLength + 1) },
          body: Buffer.concat([png, Buffer.from("x")]),
        })
      ).status,
      403,
    );
    // The URL covers only its own key.
    const otherKey = upload.uploadUrl.replace(upload.uploadId, randomUUID());
    assert.equal((await fetch(otherKey, { method: "PUT", headers: upload.headers, body: png })).status, 403);

    const put = await fetch(upload.uploadUrl, { method: "PUT", headers: upload.headers, body: png });
    assert.equal(put.status, 200);
    const stagingUrl = `${config.endpoint}/${config.uploadsBucket}/shop-logos/${owner.shopId}/${upload.uploadId}`;
    assert.equal((await fetch(stagingUrl)).status, 403, "staging objects are never publicly readable");

    const { logoUrl } = await logos.complete(owner, upload.uploadId);
    assert.ok(logoUrl.startsWith(`${config.mediaPublicBaseUrl}/shop-logos/${owner.shopId}/${upload.uploadId}/`));
    const media = await fetch(logoUrl);
    assert.equal(media.status, 200);
    assert.equal(media.headers.get("content-type"), "image/png");
    const served = await sharp(Buffer.from(await media.arrayBuffer())).metadata();
    assert.deepEqual([served.format, served.width, served.height, served.exif], ["png", 64, 64, undefined]);
    assert.equal((await prisma.shop.findUniqueOrThrow({ where: { id: owner.shopId } })).logoUrl, logoUrl);

    await runLogoCleanup({ prisma, storage, timing, mediaPublicBaseUrl: config.mediaPublicBaseUrl });
    assert.equal((await storage.readStaging(`shop-logos/${owner.shopId}/${upload.uploadId}`, 10)).kind, "missing");
  });

  it("reads of staged objects are capped, and deleting a missing key succeeds", async () => {
    const key = `shop-logos/test/${randomUUID()}`;
    await admin.send(new PutObjectCommand({ Bucket: config.uploadsBucket, Key: key, Body: Buffer.alloc(3_000_000) }));
    assert.equal((await storage.readStaging(key, 2_097_152)).kind, "tooLarge");
    assert.equal((await storage.readStaging(`${key}-missing`, 10)).kind, "missing");
    await storage.deleteMedia(`missing/${randomUUID()}`);
    await storage.deleteStaging(key);
    assert.equal((await storage.readStaging(key, 10)).kind, "missing");
  });
});
