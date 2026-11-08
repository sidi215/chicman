import assert from "node:assert/strict";
import { describe, it } from "node:test";

import sharp from "sharp";

import { ConcurrencyLimiter } from "../src/lib/concurrency-limiter.js";
import { normalizeProductImage, type NormalizedImage } from "../src/modules/products/images/image-normalizer.js";

type Format = "jpeg" | "png" | "webp";
const FORMATS: Format[] = ["jpeg", "png", "webp"];
const type = (format: Format) => `image/${format}`;

const SECRET_MODEL = "SecretPhoneModel";
const SECRET_MAKE = "SecretPhoneMake";
const EXIF = {
  IFD0: { Make: SECRET_MAKE, Model: SECRET_MODEL, Software: "SecretSoftware" },
  IFD3: { GPSLatitudeRef: "N", GPSLatitude: "18/1 5/1 0/1", GPSLongitudeRef: "W", GPSLongitude: "15/1 58/1 0/1" },
};

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 90 } } });
const noisy = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 120, g: 120, b: 120 }, noise: { type: "gaussian", mean: 128, sigma: 60 } } });

async function normalized(bytes: Buffer, contentType: string): Promise<NormalizedImage> {
  const result = await normalizeProductImage(bytes, contentType);
  assert.equal(result.ok, true, result.ok ? "" : result.code);
  return result as NormalizedImage;
}

describe("product image normalization (spec 07)", () => {
  for (const format of FORMATS) {
    describe(format, () => {
      it("reduces an oversized photo to 1024 at most, keeping the format and proportions", async () => {
        const input = await solid(4000, 3000).toFormat(format).toBuffer();
        const out = await normalized(input, type(format));
        assert.deepEqual([out.width, out.height, out.contentType], [1024, 768, type(format)]);
        const meta = await sharp(out.bytes).metadata();
        assert.deepEqual([meta.format, meta.width, meta.height], [format, 1024, 768]);
      });

      it("handles portrait photos, and never enlarges small images", async () => {
        const portrait = await normalized(await solid(3000, 4000).toFormat(format).toBuffer(), type(format));
        assert.deepEqual([portrait.width, portrait.height], [768, 1024]);
        const small = await normalized(await solid(120, 80).toFormat(format).toBuffer(), type(format));
        assert.deepEqual([small.width, small.height], [120, 80]);
      });

      it("removes EXIF (GPS, device), XMP, and ICC, even from small images", async () => {
        const input = await solid(300, 200)
          .withExif(EXIF)
          .withXmp(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>SecretXmp</rdf:Description></rdf:RDF></x:xmpmeta>`)
          .toFormat(format)
          .toBuffer();
        // The fixture really carries what must disappear.
        const before = await sharp(input).metadata();
        assert.ok(before.exif && before.xmp);
        assert.ok(input.includes(SECRET_MODEL));

        const out = await normalized(input, type(format));
        const after = await sharp(out.bytes).metadata();
        assert.deepEqual([after.exif, after.xmp, after.iptc, after.icc, after.orientation], [undefined, undefined, undefined, undefined, undefined]);
        for (const secret of [SECRET_MODEL, SECRET_MAKE, "SecretSoftware", "SecretXmp", "Exif"]) {
          assert.ok(!out.bytes.includes(secret), `${secret} survived`);
        }
      });

      it("turns the image upright from its EXIF orientation", async () => {
        // Left half red, right half blue, stored rotated: orientation 6 means "rotate 90° clockwise".
        const half = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#ff0000" } }).png().toBuffer();
        const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#0000ff" } })
          .composite([{ input: half, left: 0, top: 0 }])
          .withMetadata({ orientation: 6 })
          .toFormat(format, format === "jpeg" ? { quality: 95 } : {})
          .toBuffer();
        const out = await normalized(input, type(format));
        assert.deepEqual([out.width, out.height], [100, 200]);
        const { data, info } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
        const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3)];
        const [topRed, , topBlue] = pixel(50, 20) as [number, number, number];
        const [bottomRed, , bottomBlue] = pixel(50, 180) as [number, number, number];
        assert.ok(topRed > 200 && topBlue < 60, "the stored left half ends up on top");
        assert.ok(bottomBlue > 200 && bottomRed < 60, "the stored right half ends up at the bottom");
      });

      it("the output stays within 2 MB, even for very noisy images", async () => {
        const input = await noisy(1024, 1024).toFormat(format).toBuffer();
        const out = await normalized(input, type(format));
        assert.ok(out.bytes.byteLength <= 2_097_152, `${out.bytes.byteLength} bytes`);
        assert.deepEqual([out.width, out.height], [1024, 1024]);
      });

      it("removes data appended after the image", async () => {
        const input = Buffer.concat([await solid(50, 50).toFormat(format).toBuffer(), Buffer.from("<script>alert('SecretPayload')</script>")]);
        const out = await normalizeProductImage(input, type(format));
        if (out.ok) assert.ok(!out.bytes.includes("SecretPayload"));
        else assert.equal(out.code, "PRODUCT_IMAGE_INVALID");
      });
    });
  }

  it("preserves acceptable quality: a resized gradient stays close to the original", async () => {
    const width = 2048;
    const raw = Buffer.alloc(width * width * 3);
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 3;
        raw[offset] = Math.floor((x / width) * 255);
        raw[offset + 1] = Math.floor((y / width) * 255);
        raw[offset + 2] = 128;
      }
    }
    const input = await sharp(raw, { raw: { width, height: width, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    const out = await normalized(input, "image/jpeg");
    const { data } = await sharp(out.bytes).raw().toBuffer({ resolveWithObject: true });
    let total = 0;
    for (let y = 0; y < 1024; y += 8) {
      for (let x = 0; x < 1024; x += 8) {
        const offset = (y * 1024 + x) * 3;
        total += Math.abs((data[offset] ?? 0) - (x / 1024) * 255) + Math.abs((data[offset + 1] ?? 0) - (y / 1024) * 255);
      }
    }
    assert.ok(total / (128 * 128 * 2) < 3, `average error ${total / (128 * 128 * 2)}`);
  });

  it("keeps transparency in PNG and WebP", async () => {
    for (const format of ["png", "webp"] as const) {
      const input = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).toFormat(format).toBuffer();
      const out = await normalized(input, type(format));
      assert.equal((await sharp(out.bytes).metadata()).hasAlpha, true);
    }
  });

  it("converts wide-gamut and CMYK images to plain sRGB", async () => {
    const p3 = await solid(40, 40).withIccProfile("p3").jpeg().toBuffer();
    assert.ok((await sharp(p3).metadata()).icc);
    const fromP3 = await sharp((await normalized(p3, "image/jpeg")).bytes).metadata();
    assert.deepEqual([fromP3.icc, fromP3.space], [undefined, "srgb"]);
    const cmyk = await solid(40, 40).toColourspace("cmyk").jpeg().toBuffer();
    assert.equal((await sharp(cmyk).metadata()).space, "cmyk");
    assert.equal((await sharp((await normalized(cmyk, "image/jpeg")).bytes).metadata()).space, "srgb");
  });

  it("handles grayscale and 16-bit images", async () => {
    const gray = await solid(40, 40).toColourspace("b-w").png().toBuffer();
    assert.equal((await normalized(gray, "image/png")).width, 40);
    const deep = await solid(40, 40).toColourspace("rgb16").png().toBuffer();
    assert.equal((await normalized(deep, "image/png")).width, 40);
  });

  describe("invalid files", () => {
    it("refuses SVG, HTML, GIF, and empty files, whatever the declared type", async () => {
      const files = [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        Buffer.from("<!doctype html><script>alert(1)</script>"),
        Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "latin1"),
        Buffer.alloc(0),
      ];
      for (const file of files) {
        for (const format of FORMATS) {
          assert.deepEqual(await normalizeProductImage(file, type(format)), { ok: false, code: "PRODUCT_IMAGE_UNSUPPORTED_TYPE" });
        }
      }
    });

    it("refuses a file whose content differs from the declared type, and unsupported declared types", async () => {
      const png = await solid(10, 10).png().toBuffer();
      assert.deepEqual(await normalizeProductImage(png, "image/jpeg"), { ok: false, code: "PRODUCT_IMAGE_UNSUPPORTED_TYPE" });
      assert.deepEqual(await normalizeProductImage(png, "image/svg+xml"), { ok: false, code: "PRODUCT_IMAGE_UNSUPPORTED_TYPE" });
    });

    it("refuses truncated and corrupt images", async () => {
      for (const format of FORMATS) {
        const good = await noisy(300, 300).toFormat(format).toBuffer();
        assert.deepEqual(await normalizeProductImage(good.subarray(0, Math.floor(good.length / 2)), type(format)), { ok: false, code: "PRODUCT_IMAGE_INVALID" });
      }
      const png = await solid(200, 200).png().toBuffer();
      const corrupt = Buffer.from(png);
      corrupt.fill(0, 40, png.length - 20);
      assert.deepEqual(await normalizeProductImage(corrupt, "image/png"), { ok: false, code: "PRODUCT_IMAGE_INVALID" });
    });

    it("refuses files over 15 MB before reading them", async () => {
      assert.deepEqual(await normalizeProductImage(Buffer.alloc(15_728_641, 0xff), "image/jpeg"), { ok: false, code: "PRODUCT_IMAGE_TOO_LARGE" });
    });

    it("refuses too many pixels from the header, before decoding (decompression bomb)", async () => {
      const bomb = await sharp({ create: { width: 8001, height: 8000, channels: 3, background: "#000000" } }).png({ compressionLevel: 9 }).toBuffer();
      assert.ok(bomb.byteLength < 15_728_640, "small file, many pixels");
      assert.deepEqual(await normalizeProductImage(bomb, "image/png"), { ok: false, code: "PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS" });
    });
  });
});

describe("concurrency limiter", () => {
  it("never exceeds its limit, runs everything, and frees slots after failures", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 8 }, (_, index) =>
      limiter.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (index % 3 === 0) throw new Error("task failed");
        return index;
      }),
    );
    const results = await Promise.allSettled(tasks);
    assert.equal(peak, 2);
    assert.equal(results.filter((r) => r.status === "rejected").length, 3);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 5);
    assert.equal(await limiter.run(async () => "free"), "free");
  });
});
