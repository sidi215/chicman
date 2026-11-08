/** Shop management constants (spec 06). */

/** Field bounds, counted after NFC normalization and trimming. */
export const SHOP_FIELD_LIMITS = {
  shopName: 100,
  description: 2000,
  city: 100,
  address: 300,
} as const;

/** Every administrative decision carries exactly one reason of this length. */
export const DECISION_REASON_MIN_LENGTH = 10;
export const DECISION_REASON_MAX_LENGTH = 500;
/** Optional administrator-only note on any decision. */
export const INTERNAL_NOTE_MAX_LENGTH = 1000;

/** Application fields of a shop. */
export const SHOP_FIELDS = [
  "shopName",
  "description",
  "contactPhone",
  "city",
  "address",
  "whatsappPhone",
  "logoUrl",
] as const;
export type ShopField = (typeof SHOP_FIELDS)[number];

/** Fields that need administrator re-review once the shop is `APPROVED`. */
export const SHOP_REVIEW_FIELDS = ["shopName", "city"] as const satisfies readonly ShopField[];

/** Which administrative decision produced the shop's current state. Not a status. */
export const SHOP_DECISION_TYPES = ["APPLICATION_APPROVED", "APPLICATION_REJECTED", "SUSPENDED", "REINSTATED"] as const;
export type ShopDecisionType = (typeof SHOP_DECISION_TYPES)[number];

export const SHOP_CHANGE_REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type ShopChangeRequestStatus = (typeof SHOP_CHANGE_REQUEST_STATUSES)[number];

/** Source of a recorded field change. */
export const SHOP_FIELD_CHANGE_SOURCES = ["OWNER_UPDATE", "CHANGE_REQUEST_APPROVED", "LOGO_UPLOAD"] as const;
export type ShopFieldChangeSource = (typeof SHOP_FIELD_CHANGE_SOURCES)[number];

/** Logo upload constraints. */
export const LOGO_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type LogoContentType = (typeof LOGO_CONTENT_TYPES)[number];
/** Largest published logo, which the server produces by normalizing the upload. 2 MB. */
export const LOGO_MAX_BYTES = 2_097_152;
/** Maximum published width and height, in pixels. */
export const LOGO_MAX_DIMENSION = 1024;
/** Largest uploaded original, so phone photos can reach the server. 15 MB. */
export const LOGO_MAX_UPLOAD_BYTES = 15_728_640;
/** Checked from the file header before decoding: bounds memory against decompression bombs. */
export const LOGO_MAX_INPUT_PIXELS = 64_000_000;
/** Presigned PUT lifetime. */
export const LOGO_UPLOAD_URL_TTL_SECONDS = 300;

/** Terminal verification failures of a staged logo (`422`). */
export const LOGO_REJECTION_CODES = [
  "LOGO_TOO_LARGE",
  "LOGO_UNSUPPORTED_TYPE",
  "LOGO_TOO_LARGE_DIMENSIONS",
  "LOGO_INVALID_IMAGE",
] as const;
export type LogoRejectionCode = (typeof LOGO_REJECTION_CODES)[number];

/** Owner notification kinds, one per administrative decision. */
export const SHOP_NOTIFICATION_TYPES = [
  "SHOP_APPLICATION_APPROVED",
  "SHOP_APPLICATION_REJECTED",
  "SHOP_SUSPENDED",
  "SHOP_REINSTATED",
  "SHOP_CHANGE_REQUEST_APPROVED",
  "SHOP_CHANGE_REQUEST_REJECTED",
] as const;
export type ShopNotificationType = (typeof SHOP_NOTIFICATION_TYPES)[number];

/**
 * Stable error codes of the shop endpoints.
 *
 * - `SHOP_ALREADY_EXISTS` (409): the user already owns a shop.
 * - `SHOP_NOT_FOUND` (404): the user owns no shop, or the shop is not disclosed.
 * - `SHOP_STATUS_CONFLICT` (409): the transition is not allowed from the
 *   current status, or a concurrent action won.
 * - `REVIEW_FIELD_NOT_EDITABLE` (400): `shopName`/`city` on an approved shop
 *   go through a change request.
 * - `CHANGE_REQUEST_OPEN` (409): the shop already has an open change request.
 * - `CHANGE_REQUEST_NOT_FOUND` (404), `CHANGE_REQUEST_CONFLICT` (409).
 * - `LOGO_UPLOAD_NOT_FOUND` (404), `LOGO_NOT_UPLOADED` (422, retryable),
 *   `LOGO_COMPLETION_IN_PROGRESS` (409, retry later), `LOGO_UPLOAD_EXPIRED`
 *   (410), `LOGO_STORAGE_UNAVAILABLE` (503), plus the rejection codes (422).
 * - `LOGO_STORAGE_NOT_CONFIGURED` (503): object storage is not configured.
 * - `SHOP_SELF_ADMINISTRATION_FORBIDDEN` (403): an administrator cannot take
 *   administrative decisions on, or read the administrative history of, a
 *   shop they own, even with the `ADMIN` role.
 */
export const SHOP_ERROR_CODES = {
  shopAlreadyExists: "SHOP_ALREADY_EXISTS",
  shopNotFound: "SHOP_NOT_FOUND",
  shopStatusConflict: "SHOP_STATUS_CONFLICT",
  reviewFieldNotEditable: "REVIEW_FIELD_NOT_EDITABLE",
  changeRequestOpen: "CHANGE_REQUEST_OPEN",
  changeRequestNotFound: "CHANGE_REQUEST_NOT_FOUND",
  changeRequestConflict: "CHANGE_REQUEST_CONFLICT",
  logoUploadNotFound: "LOGO_UPLOAD_NOT_FOUND",
  logoNotUploaded: "LOGO_NOT_UPLOADED",
  logoCompletionInProgress: "LOGO_COMPLETION_IN_PROGRESS",
  logoUploadExpired: "LOGO_UPLOAD_EXPIRED",
  logoStorageUnavailable: "LOGO_STORAGE_UNAVAILABLE",
  logoStorageNotConfigured: "LOGO_STORAGE_NOT_CONFIGURED",
  selfAdministrationForbidden: "SHOP_SELF_ADMINISTRATION_FORBIDDEN",
} as const;
