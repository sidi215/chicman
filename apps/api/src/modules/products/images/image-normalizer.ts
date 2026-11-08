import {
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MAX_DIMENSION,
  PRODUCT_IMAGE_MAX_INPUT_PIXELS,
  PRODUCT_IMAGE_MAX_UPLOAD_BYTES,
  type ProductImageRejectionCode,
} from "@chicman/shared";

import { normalizeImage, type ImageRejection, type NormalizedImage } from "../../media/index.js";

export type { NormalizedImage };
export type ProductImageNormalization = NormalizedImage | { ok: false; code: ProductImageRejectionCode };

const REJECTION_CODES: Record<ImageRejection, ProductImageRejectionCode> = {
  TOO_LARGE: "PRODUCT_IMAGE_TOO_LARGE",
  UNSUPPORTED_TYPE: "PRODUCT_IMAGE_UNSUPPORTED_TYPE",
  TOO_MANY_PIXELS: "PRODUCT_IMAGE_TOO_LARGE_DIMENSIONS",
  INVALID: "PRODUCT_IMAGE_INVALID",
};

/** Normalizes an uploaded product image (spec 07, section 5) with its limits and error codes. */
export async function normalizeProductImage(input: Buffer, declaredType: string): Promise<ProductImageNormalization> {
  const result = await normalizeImage(input, declaredType, {
    maxUploadBytes: PRODUCT_IMAGE_MAX_UPLOAD_BYTES,
    maxInputPixels: PRODUCT_IMAGE_MAX_INPUT_PIXELS,
    maxOutputBytes: PRODUCT_IMAGE_MAX_BYTES,
    maxDimension: PRODUCT_IMAGE_MAX_DIMENSION,
  });
  return result.ok ? result : { ok: false, code: REJECTION_CODES[result.rejection] };
}
