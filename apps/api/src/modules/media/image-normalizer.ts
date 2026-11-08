import sharp from "sharp";

import { ConcurrencyLimiter } from "../../lib/concurrency-limiter.js";

// Decoding limits: no cache and one thread per image.
sharp.cache(false);
sharp.concurrency(1);

export type ImageContentType = "image/jpeg" | "image/png" | "image/webp";

/** What one feature allows. Each feature keeps its own limits and error codes. */
export interface ImageLimits {
  /** Largest uploaded original. */
  maxUploadBytes: number;
  /** Checked from the header before decoding: bounds memory against decompression bombs. */
  maxInputPixels: number;
  /** Largest published image. */
  maxOutputBytes: number;
  /** Largest published width and height. */
  maxDimension: number;
}

export type ImageRejection = "TOO_LARGE" | "UNSUPPORTED_TYPE" | "TOO_MANY_PIXELS" | "INVALID";

export interface NormalizedImage {
  ok: true;
  /** The only bytes that may become public. */
  bytes: Buffer;
  contentType: ImageContentType;
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

export type ImageNormalization = NormalizedImage | { ok: false; rejection: ImageRejection };

/**
 * Originals read and normalized at once by this process, across every feature.
 * An original can take 15 MB to hold and much more to decode, so one shared
 * limit bounds the memory used.
 */
export const imageProcessing = new ConcurrencyLimiter(2);

type Image = ReturnType<typeof sharp>;
type Encoder = (image: Image) => Image;

/**
 * Per format: its name in sharp, its file extension, and encoders from the
 * best quality down. The first result within the size limit is kept.
 */
const FORMATS: Record<ImageContentType, { sharpFormat: string; extension: NormalizedImage["extension"]; encoders: Encoder[] }> = {
  "image/jpeg": {
    sharpFormat: "jpeg",
    extension: "jpg",
    encoders: [85, 75, 65, 50].map((quality) => (image: Image) => image.jpeg({ quality, mozjpeg: true })),
  },
  "image/png": {
    sharpFormat: "png",
    extension: "png",
    encoders: [
      (image) => image.png({ compressionLevel: 9 }),
      (image) => image.png({ compressionLevel: 9, palette: true, quality: 90 }),
      (image) => image.png({ compressionLevel: 9, palette: true, quality: 60, colours: 128 }),
    ],
  },
  "image/webp": {
    sharpFormat: "webp",
    extension: "webp",
    encoders: [82, 72, 62, 50].map((quality) => (image: Image) => image.webp({ quality })),
  },
};

/** Detects the type from the file signature (magic bytes) only. */
export function detectImageType(bytes: Uint8Array): ImageContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= png.length && png.every((byte, i) => bytes[i] === byte)) return "image/png";
  const ascii = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString("latin1");
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Normalizes an uploaded image (specs 06 and 07). This is the security
 * boundary: nothing done by a client is trusted.
 *
 * The file signature must match the declared type, and the pixel count is
 * checked from the header before any pixel is decoded. The image is then
 * decoded, turned upright, reduced to the maximum dimension without enlarging,
 * and re-encoded in the same format. Re-encoding keeps only the pixels, so
 * EXIF (GPS, device), XMP, IPTC, ICC profiles, and any data appended to the
 * file are gone. Only the first frame of an animated image is kept.
 */
export async function normalizeImage(input: Buffer, declaredType: string, limits: ImageLimits): Promise<ImageNormalization> {
  if (input.byteLength > limits.maxUploadBytes) return { ok: false, rejection: "TOO_LARGE" };
  const detected = detectImageType(input);
  if (detected === null || detected !== declaredType) return { ok: false, rejection: "UNSUPPORTED_TYPE" };
  const format = FORMATS[detected];

  try {
    // Header only: no pixel data is decoded here.
    const header = await sharp(input, { limitInputPixels: false, failOn: "error" }).metadata();
    if (header.format !== format.sharpFormat) return { ok: false, rejection: "UNSUPPORTED_TYPE" };
    if (header.width === undefined || header.height === undefined || header.width < 1 || header.height < 1) {
      return { ok: false, rejection: "INVALID" };
    }
    if (header.width * header.height > limits.maxInputPixels) return { ok: false, rejection: "TOO_MANY_PIXELS" };

    // Full decode: truncated or corrupt data fails here. Raw pixels carry no metadata.
    const { data: pixels, info } = await sharp(input, { limitInputPixels: limits.maxInputPixels, failOn: "error" })
      .autoOrient()
      .resize(limits.maxDimension, limits.maxDimension, { fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = { raw: { width: info.width, height: info.height, channels: info.channels } };

    for (const encode of format.encoders) {
      const bytes = await encode(sharp(pixels, raw)).toBuffer();
      if (bytes.byteLength > limits.maxOutputBytes) continue;
      // The result is checked too: an unexpected output is never published.
      const output = await sharp(bytes).metadata();
      const clean =
        output.format === format.sharpFormat &&
        output.width === info.width &&
        output.height === info.height &&
        output.width <= limits.maxDimension &&
        output.height <= limits.maxDimension &&
        output.exif === undefined &&
        output.xmp === undefined &&
        output.iptc === undefined &&
        output.icc === undefined;
      if (!clean) return { ok: false, rejection: "INVALID" };
      return { ok: true, bytes, contentType: detected, extension: format.extension, width: info.width, height: info.height };
    }
    return { ok: false, rejection: "TOO_LARGE" };
  } catch {
    return { ok: false, rejection: "INVALID" };
  }
}
