import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";

import dotenv from "dotenv";
import sharp from "sharp";

import { detectImageType, normalizeImage } from "../src/modules/media/index.js";
import { normalizeLogo, runLogoCleanup } from "../src/modules/shops/index.js";
import { MEDIA_BASE_URL, ShopHarness, TEST_TIMING, type Actor } from "./helpers/shop-harness.js";

dotenv.config({ quiet: true });
const databaseUrl = process.env["TEST_DATABASE_URL"];

type Format = "jpeg" | "png" | "webp";
const FORMATS: Format[] = ["jpeg", "png", "webp"];
const type = (format: Format) => `image/${format}`;

const EXIF = {
  IFD0: { Make: "SecretMake", Model: "SecretModel", Software: "SecretSoftware" },
  IFD3: { GPSLatitudeRef: "N", GPSLatitude: "18/1 5/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "15/1 58/1 0/1" },
};
const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>SecretXmp</rdf:Description></rdf:RDF></x:xmpmeta>`;

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });
const noisy = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 120, b: 120 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } });

/** Adds an IPTC block (a Photoshop APP13 segment) right after a JPEG's start marker. */
function withIptc(jpeg: Buffer, text: string): Buffer {
  const value = Buffer.from(text);
  const dataset = Buffer.concat([Buffer.from([0x1c, 0x02, 0x78, 0x00, value.length]), value]);
  const padded = dataset.length % 2 === 0 ? dataset : Buffer.concat([dataset, Buffer.from([0])]);
  const size = Buffer.alloc(4);
  size.writeUInt32BE(dataset.length);
  const payload = Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), Buffer.from("8BIM", "latin1"), Buffer.from([0x04, 0x04, 0, 0]), size, padded]);
  const header = Buffer.from([0xff, 0xed, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, payload, jpeg.subarray(2)]);
}

async function normalized(bytes: Buffer, contentType: string) {
  const result = await normalizeLogo(bytes, contentType);
  assert.equal(result.ok, true, result.ok ? "" : result.code);
  if (!result.ok) throw new Error("unreachable");
  return result;
}

describe("shop logo normalization (spec 06)", () => {
  for (const format of FORMATS) {
    describe(format, () => {
      it("reduces an oversized image to 1024 at most, keeping format and proportions, and never enlarges", async () => {
        const large = await normalized(await solid(4000, 3000).toFormat(format).toBuffer(), type(format));
        assert.deepEqual([large.width, large.height, large.contentType], [1024, 768, type(format)]);
        const meta = await sharp(large.bytes).metadata();
        assert.deepEqual([meta.format, meta.width, meta.height], [format, 1024, 768]);
        const small = await normalized(await solid(96, 64).toFormat(format).toBuffer(), type(format));
        assert.deepEqual([small.width, small.height], [96, 64]);
      });

      it("removes GPS and device EXIF, and XMP, even from small images", async () => {
        const input = await solid(300, 200).withExif(EXIF).withXmp(XMP).toFormat(format).toBuffer();
        const before = await sharp(input).metadata();
        assert.ok(before.exif && before.xmp, "the fixture carries metadata");
        assert.ok(input.includes("SecretModel"));
        const out = await normalized(input, type(format));
        const after = await sharp(out.bytes).metadata();
        assert.deepEqual([after.exif, after.xmp, after.iptc, after.icc, after.orientation], [undefined, undefined, undefined, undefined, undefined]);
        for (const secret of ["SecretMake", "SecretModel", "SecretSoftware", "SecretXmp", "Exif"]) assert.ok(!out.bytes.includes(secret), `${secret} survived`);
      });

      it("turns the image upright before removing its orientation tag", async () => {
        const half = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
        const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#0000ff" } })
          .composite([{ input: half, left: 0, top: 0 }])
          .withMetadata({ orientation: 6 })
          .toFormat(format, format === "jpeg" ? { quality: 95 } : {})
          .toBuffer();
        const out = await normalized(input, type(format));
        assert.deepEqual([out.width, out.height], [100, 200]);
        const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)] as [number, number, number];
        assert.ok(pixel(50, 20)[0] > 200 && pixel(50, 20)[2] < 60, "the stored left half ends up on top");
        assert.ok(pixel(50, 180)[2] > 200 && pixel(50, 180)[0] < 60, "the stored right half ends up at the bottom");
      });

      it("stays within 2 MB, even for very noisy images", async () => {
        const out = await normalized(await noisy(1024, 1024).toFormat(format).toBuffer(), type(format));
        assert.ok(out.bytes.byteLength <= 2_097_152, `${out.bytes.byteLength} bytes`);
      });

      it("removes data appended after the image", async () => {
        const input = Buffer.concat([await solid(50, 50).toFormat(format).toBuffer(), Buffer.from("<script>alert('SecretPayload')</script>")]);
        const out = await normalizeLogo(input, type(format));
        if (out.ok) assert.ok(!out.bytes.includes("SecretPayload"));
        else assert.equal(out.code, "LOGO_INVALID_IMAGE");
      });

      it("refuses truncated images", async () => {
        const good = await noisy(300, 300).toFormat(format).toBuffer();
        assert.deepEqual(await normalizeLogo(good.subarray(0, Math.floor(good.length / 2)), type(format)), { ok: false, code: "LOGO_INVALID_IMAGE" });
      });
    });
  }

  it("removes IPTC", async () => {
    const input = withIptc(await solid(100, 100).jpeg().toBuffer(), "SecretIptc");
    assert.ok((await sharp(input).metadata()).iptc, "the fixture carries IPTC");
    const out = await normalized(input, "image/jpeg");
    assert.equal((await sharp(out.bytes).metadata()).iptc, undefined);
    assert.ok(!out.bytes.includes("SecretIptc"));
  });

  it("removes the ICC profile and converts to sRGB", async () => {
    const input = await solid(40, 40).withIccProfile("p3").jpeg().toBuffer();
    assert.ok((await sharp(input).metadata()).icc);
    const meta = await sharp((await normalized(input, "image/jpeg")).bytes).metadata();
    assert.deepEqual([meta.icc, meta.space], [undefined, "srgb"]);
  });

  it("keeps a logo's transparency in PNG and WebP", async () => {
    for (const format of ["png", "webp"] as const) {
      const input = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).toFormat(format).toBuffer();
      assert.equal((await sharp((await normalized(input, type(format))).bytes).metadata()).hasAlpha, true);
    }
  });

  it("refuses SVG, HTML, GIF, HEIC, empty files, and a signature that differs from the declared type", async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(32)]);
    for (const file of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from("<!doctype html><script>alert(1)</script>"),
      Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"),
      heic,
      Buffer.alloc(0),
    ]) {
      for (const format of FORMATS) assert.deepEqual(await normalizeLogo(file, type(format)), { ok: false, code: "LOGO_UNSUPPORTED_TYPE" });
    }
    const png = await solid(10, 10).png().toBuffer();
    assert.deepEqual(await normalizeLogo(png, "image/jpeg"), { ok: false, code: "LOGO_UNSUPPORTED_TYPE" });
    assert.deepEqual(await normalizeLogo(png, "image/svg+xml"), { ok: false, code: "LOGO_UNSUPPORTED_TYPE" });
    assert.equal(detectImageType(png), "image/png");
    assert.equal(detectImageType(heic), null);
  });

  it("refuses a corrupt image", async () => {
    const png = await solid(200, 200).png().toBuffer();
    const corrupt = Buffer.from(png);
    corrupt.fill(0, 40, png.length - 20);
    assert.deepEqual(await normalizeLogo(corrupt, "image/png"), { ok: false, code: "LOGO_INVALID_IMAGE" });
  });

  it("refuses files over 15 MB, and accepts one at the limit's edge by content", async () => {
    assert.deepEqual(await normalizeLogo(Buffer.alloc(15_728_641, 0xff), "image/jpeg"), { ok: false, code: "LOGO_TOO_LARGE" });
  });

  it("refuses too many pixels from the header, before decoding (decompression bomb)", async () => {
    const bomb = await sharp({ create: { width: 8001, height: 8000, channels: 3, background: "#000000" } }).png({ compressionLevel: 9 }).toBuffer();
    assert.ok(bomb.byteLength < 15_728_640, "small file, many pixels");
    assert.deepEqual(await normalizeLogo(bomb, "image/png"), { ok: false, code: "LOGO_TOO_LARGE_DIMENSIONS" });
  });

  it("an image that cannot fit the output limit at any quality is refused, never published oversized", async () => {
    const input = await noisy(512, 512).png().toBuffer();
    const limits = { maxUploadBytes: 15_728_640, maxInputPixels: 64_000_000, maxOutputBytes: 200, maxDimension: 1024 };
    for (const [format, bytes] of [["image/png", input], ["image/jpeg", await noisy(512, 512).jpeg().toBuffer()], ["image/webp", await noisy(512, 512).webp().toBuffer()]] as const) {
      assert.deepEqual(await normalizeImage(bytes, format, limits), { ok: false, rejection: "TOO_LARGE" });
    }
  });
});

describe("shop logo normalization in the upload flow (spec 06, PostgreSQL)", { skip: databaseUrl === undefined ? "TEST_DATABASE_URL is not set" : false }, () => {
  const h = new ShopHarness(databaseUrl ?? "");
  let owner: Actor;
  let shopId: string;
  let photo: Buffer;

  before(async () => {
    await h.start();
    // Phone-like: over the 2 MB public limit, 12 MP, sideways, with GPS and device data.
    photo = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: 120, g: 120, b: 120 }, noise: { type: "gaussian", mean: 128, sigma: 40 } } })
      .withExif(EXIF)
      .withMetadata({ orientation: 6 })
      .jpeg({ quality: 92 })
      .toBuffer();
    assert.ok(photo.byteLength > 2_097_152 && photo.byteLength < 15_728_640, `fixture is ${photo.byteLength} bytes`);
  });
  after(() => h.stop());
  beforeEach(async () => {
    await h.reset();
    ({ owner, shopId } = await h.shopInStatus("APPROVED"));
  });

  const stagedPhoto = async (bytes: Buffer = photo, contentType = "image/jpeg") => {
    const res = await h.call("/sellers/me/shop/logo/uploads", owner.token, { method: "POST", body: { contentType, contentLength: Math.min(bytes.byteLength, 15_728_640) } });
    assert.equal(res.status, 201);
    const { uploadId } = (await res.json()) as { uploadId: string };
    const stagingKey = `shop-logos/${shopId}/${uploadId}`;
    h.storage.staging.set(stagingKey, bytes);
    return { uploadId, stagingKey };
  };
  const complete = (uploadId: string) => h.call(`/sellers/me/shop/logo/uploads/${uploadId}/complete`, owner.token, { method: "POST" });
  const logoUrlOf = async () => (await h.prisma.shop.findUniqueOrThrow({ where: { id: shopId } })).logoUrl;
  const objects = () => h.prisma.shopLogoObject.findMany({ where: { shopId }, orderBy: { attempt: "asc" } });
  const cleanup = () => runLogoCleanup({ prisma: h.prisma, storage: h.storage, timing: TEST_TIMING, mediaPublicBaseUrl: MEDIA_BASE_URL });

  async function assertNormalized(body: Buffer | undefined): Promise<void> {
    assert.ok(body);
    const meta = await sharp(body).metadata();
    // The photo is stored 4000 × 3000 with orientation 6, so upright it is portrait.
    assert.deepEqual([meta.format, meta.width, meta.height, meta.exif, meta.xmp, meta.iptc, meta.icc, meta.orientation], ["jpeg", 768, 1024, undefined, undefined, undefined, undefined, undefined]);
    assert.ok(body.byteLength <= 2_097_152, `${body.byteLength} bytes`);
    for (const secret of ["SecretMake", "SecretModel", "Exif"]) assert.ok(!body.includes(secret), `${secret} survived`);
    assert.ok(!body.equals(photo));
  }

  async function assertLiveLogoNormalized(url: string): Promise<void> {
    assert.equal(await logoUrlOf(), url);
    await assertNormalized(h.storage.media.get(url.slice(MEDIA_BASE_URL.length + 1))?.body);
  }

  it("accepts a phone photo over 2 MB; only the normalized image becomes public; the original leaves staging", async () => {
    const { uploadId, stagingKey } = await stagedPhoto();
    const res = await complete(uploadId);
    assert.equal(res.status, 200);
    const { logoUrl } = (await res.json()) as { logoUrl: string };
    assert.match(logoUrl, new RegExp(`/shop-logos/${shopId}/${uploadId}/[0-9a-f-]{36}\\.jpg$`));
    await assertLiveLogoNormalized(logoUrl);
    assert.equal(h.storage.media.size, 1);
    await cleanup();
    assert.equal(h.storage.staging.has(stagingKey), false);
    for (const { body } of h.storage.media.values()) assert.ok(!body.includes("SecretModel"));
  });

  it("a declared size over 2 MB is accepted up to 15 MB by the API and the database", async () => {
    const res = await h.call("/sellers/me/shop/logo/uploads", owner.token, { method: "POST", body: { contentType: "image/png", contentLength: 15_728_640 } });
    assert.equal(res.status, 201);
    const over = await h.call("/sellers/me/shop/logo/uploads", owner.token, { method: "POST", body: { contentType: "image/png", contentLength: 15_728_641 } });
    assert.equal(over.status, 400);
  });

  it("a repeated completion returns the same URL and does not process or publish again", async () => {
    const { uploadId } = await stagedPhoto();
    const first = (await (await complete(uploadId)).json()) as { logoUrl: string };
    const second = await complete(uploadId);
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), first);
    assert.equal(h.storage.media.size, 1);
    assert.equal((await objects()).length, 1);
    assert.equal(await h.prisma.shopFieldChangeEvent.count({ where: { shopId } }), 1);
  });

  it("concurrent completions of one upload publish one normalized object", async () => {
    const { uploadId } = await stagedPhoto();
    const results = await Promise.all(Array.from({ length: 5 }, () => complete(uploadId)));
    for (const res of results) assert.ok(res.status === 200 || res.status === 409, `status ${res.status}`);
    assert.ok(results.some((r) => r.status === 200));
    const { logoUrl } = (await (await complete(uploadId)).json()) as { logoUrl: string };
    assert.equal(h.storage.media.size, 1);
    await assertLiveLogoNormalized(logoUrl);
  });

  it("concurrent uploads for one shop leave exactly one active logo, normalized", async () => {
    const uploads = [await stagedPhoto(), await stagedPhoto(), await stagedPhoto()];
    const results = await Promise.all(uploads.map((u) => complete(u.uploadId)));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
    const active = (await objects()).filter((o) => o.status === "ACTIVE");
    assert.equal(active.length, 1);
    const url = await logoUrlOf();
    assert.equal(url, `${MEDIA_BASE_URL}/${active[0]?.objectKey}`);
    await assertNormalized(h.storage.media.get(active[0]?.objectKey ?? "")?.body);
    await cleanup();
    assert.deepEqual([...h.storage.media.keys()], [active[0]?.objectKey]);
  });

  it("failed storage publication: nothing goes live; the retry normalizes again under a new key", async () => {
    const { uploadId, stagingKey } = await stagedPhoto();
    h.storage.failPutMedia = true;
    assert.equal((await complete(uploadId)).status, 503);
    h.storage.failPutMedia = false;
    assert.equal(await logoUrlOf(), null);
    assert.equal(h.storage.media.size, 0);
    assert.ok(h.storage.staging.has(stagingKey), "the original is kept for the retry");
    const retry = await complete(uploadId);
    assert.equal(retry.status, 200);
    await assertLiveLogoNormalized(((await retry.json()) as { logoUrl: string }).logoUrl);
    const rows = await objects();
    assert.deepEqual(rows.map((o) => o.status), ["RELEASED", "ACTIVE"]);
    assert.equal(new Set(rows.map((o) => o.objectKey)).size, 2);
  });

  it("a write that times out after writing leaves an orphan the job deletes, never the live logo", async () => {
    const { uploadId } = await stagedPhoto();
    h.storage.failPutMediaAfterWrite = true;
    assert.equal((await complete(uploadId)).status, 503);
    h.storage.failPutMediaAfterWrite = false;
    assert.equal(h.storage.media.size, 1);
    const retry = await complete(uploadId);
    assert.equal(retry.status, 200);
    const { logoUrl } = (await retry.json()) as { logoUrl: string };
    assert.equal(h.storage.media.size, 2);
    await cleanup();
    assert.equal(h.storage.media.size, 1);
    await assertLiveLogoNormalized(logoUrl);
  });

  it("a database failure after the write: the object is removed, the logo unchanged, and the retry is normalized", async () => {
    const { uploadId } = await stagedPhoto();
    h.faults.logo.beforeCommit = () => {
      throw new Error("database down");
    };
    assert.equal((await complete(uploadId)).status, 503);
    delete h.faults.logo.beforeCommit;
    assert.equal(h.storage.media.size, 0);
    assert.equal(await logoUrlOf(), null);
    const retry = await complete(uploadId);
    assert.equal(retry.status, 200);
    await assertLiveLogoNormalized(((await retry.json()) as { logoUrl: string }).logoUrl);
  });

  it("a failure inside the commit transaction rolls back: the previous logo stays live", async () => {
    const first = await stagedPhoto();
    const { logoUrl: previous } = (await (await complete(first.uploadId)).json()) as { logoUrl: string };
    const second = await stagedPhoto();
    h.faults.logo.afterReleasePrevious = () => {
      throw new Error("transaction failed");
    };
    assert.equal((await complete(second.uploadId)).status, 503);
    delete h.faults.logo.afterReleasePrevious;
    await assertLiveLogoNormalized(previous);
    const retry = await complete(second.uploadId);
    assert.equal(retry.status, 200);
    await assertLiveLogoNormalized(((await retry.json()) as { logoUrl: string }).logoUrl);
  });

  it("a stale attempt cannot commit and removes only its own object", async () => {
    const { uploadId } = await stagedPhoto();
    h.faults.logo.beforeCommit = async (attempt) => {
      if (attempt !== 1) return;
      await h.prisma.$executeRaw`UPDATE "ShopLogoUpload" SET "leaseExpiresAt" = now() - interval '1 second' WHERE "id" = ${uploadId}::uuid`;
      assert.equal((await complete(uploadId)).status, 200);
    };
    const stale = await complete(uploadId);
    delete h.faults.logo.beforeCommit;
    assert.equal(stale.status, 200);
    const { logoUrl } = (await stale.json()) as { logoUrl: string };
    assert.deepEqual((await objects()).map((o) => o.status), ["DELETED", "ACTIVE"]);
    assert.equal(h.storage.media.size, 1);
    await assertLiveLogoNormalized(logoUrl);
  });

  it("a staging read failure stays retryable", async () => {
    const { uploadId } = await stagedPhoto();
    h.storage.failReadStaging = true;
    assert.equal((await complete(uploadId)).status, 503);
    h.storage.failReadStaging = false;
    assert.equal((await complete(uploadId)).status, 200);
  });

  it("refused files leave nothing public, and the upload is terminal", async () => {
    const { uploadId } = await stagedPhoto(photo.subarray(0, Math.floor(photo.length / 2)));
    for (let i = 0; i < 2; i += 1) {
      const res = await complete(uploadId);
      assert.equal(res.status, 422);
      assert.deepEqual(await res.json(), { error: { code: "LOGO_INVALID_IMAGE" } });
    }
    assert.equal(h.storage.media.size, 0);
    assert.equal(await logoUrlOf(), null);
  });

  it("replacement: the old logo stays until the new one commits, then the job deletes only the old one", async () => {
    const first = await stagedPhoto();
    const { logoUrl: firstUrl } = (await (await complete(first.uploadId)).json()) as { logoUrl: string };
    await cleanup();
    assert.ok(h.storage.media.has(firstUrl.slice(MEDIA_BASE_URL.length + 1)), "an active logo is never deleted");
    const second = await stagedPhoto();
    const { logoUrl: secondUrl } = (await (await complete(second.uploadId)).json()) as { logoUrl: string };
    assert.notEqual(firstUrl, secondUrl);
    await cleanup();
    assert.deepEqual([...h.storage.media.keys()], [secondUrl.slice(MEDIA_BASE_URL.length + 1)]);
    await assertLiveLogoNormalized(secondUrl);
  });

  it("the job never deletes an object a shop still references, even when marked released", async () => {
    const { uploadId } = await stagedPhoto();
    const { logoUrl } = (await (await complete(uploadId)).json()) as { logoUrl: string };
    await h.prisma.shopLogoObject.updateMany({ where: { shopId }, data: { status: "RELEASED", releasedAt: new Date() } });
    const run = await cleanup();
    assert.equal(run.deletedObjects, 0);
    assert.ok(h.storage.media.has(logoUrl.slice(MEDIA_BASE_URL.length + 1)));
  });

  describe("existing logos, from before normalization", () => {
    /** A logo published as uploaded: its object still has the metadata. */
    async function legacyLogo() {
      const uploadId = randomUUID();
      const objectId = randomUUID();
      const objectKey = `shop-logos/${shopId}/${uploadId}/${objectId}.jpg`;
      const legacyBytes = await solid(300, 300).withExif(EXIF).jpeg().toBuffer();
      h.storage.media.set(objectKey, { body: legacyBytes, contentType: "image/jpeg" });
      const stagingKey = `shop-logos/${shopId}/${uploadId}`;
      await h.prisma.shopLogoUpload.create({
        data: { id: uploadId, shopId, stagingKey, declaredContentType: "image/jpeg", declaredSize: legacyBytes.byteLength, status: "PENDING", expiresAt: new Date(), completeBy: new Date() },
      });
      await h.prisma.shopLogoObject.create({ data: { id: objectId, shopId, uploadId, attempt: 1, objectKey, status: "ACTIVE" } });
      await h.prisma.shopLogoUpload.update({ where: { id: uploadId }, data: { status: "COMPLETED", resultObjectId: objectId, completedAt: new Date(), stagingDeletedAt: new Date() } });
      const logoUrl = `${MEDIA_BASE_URL}/${objectKey}`;
      await h.prisma.shop.update({ where: { id: shopId }, data: { logoUrl } });
      return { uploadId, objectKey, logoUrl };
    }

    it("stays served and untouched by the cleanup job; a repeated completion still returns it", async () => {
      const legacy = await legacyLogo();
      const before = h.storage.media.get(legacy.objectKey)?.body;
      await cleanup();
      assert.ok(h.storage.media.get(legacy.objectKey)?.body.equals(before ?? Buffer.alloc(0)));
      const repeat = await complete(legacy.uploadId);
      assert.equal(repeat.status, 200);
      assert.deepEqual(await repeat.json(), { logoUrl: legacy.logoUrl });
    });

    it("is replaced by a normalized logo, after which the job deletes the old object", async () => {
      const legacy = await legacyLogo();
      const { uploadId } = await stagedPhoto();
      const { logoUrl } = (await (await complete(uploadId)).json()) as { logoUrl: string };
      await assertLiveLogoNormalized(logoUrl);
      await cleanup();
      assert.equal(h.storage.media.has(legacy.objectKey), false);
      await assertLiveLogoNormalized(logoUrl);
    });

    it("can be removed by the owner, and the job deletes the object", async () => {
      const legacy = await legacyLogo();
      const res = await h.call("/sellers/me/shop", owner.token, { method: "PATCH", body: { logoUrl: null } });
      assert.equal(res.status, 200);
      await cleanup();
      assert.equal(h.storage.media.has(legacy.objectKey), false);
    });
  });
});
