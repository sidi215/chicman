import {
  LOGO_MAX_BYTES,
  LOGO_MAX_DIMENSION,
  LOGO_MAX_INPUT_PIXELS,
  LOGO_MAX_UPLOAD_BYTES,
  type LogoRejectionCode,
} from "@chicman/shared";

import { normalizeImage, type ImageRejection, type NormalizedImage } from "../../media/index.js";

export type LogoNormalization = NormalizedImage | { ok: false; code: LogoRejectionCode };

const REJECTION_CODES: Record<ImageRejection, LogoRejectionCode> = {
  TOO_LARGE: "LOGO_TOO_LARGE",
  UNSUPPORTED_TYPE: "LOGO_UNSUPPORTED_TYPE",
  TOO_MANY_PIXELS: "LOGO_TOO_LARGE_DIMENSIONS",
  INVALID: "LOGO_INVALID_IMAGE",
};

/** Verifies and normalizes a staged logo (spec 06, Complete step 3) with its limits and error codes. */
export async function normalizeLogo(input: Buffer, declaredType: string): Promise<LogoNormalization> {
  const result = await normalizeImage(input, declaredType, {
    maxUploadBytes: LOGO_MAX_UPLOAD_BYTES,
    maxInputPixels: LOGO_MAX_INPUT_PIXELS,
    maxOutputBytes: LOGO_MAX_BYTES,
    maxDimension: LOGO_MAX_DIMENSION,
  });
  return result.ok ? result : { ok: false, code: REJECTION_CODES[result.rejection] };
}
