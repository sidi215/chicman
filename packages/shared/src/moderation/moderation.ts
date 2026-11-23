import { z } from "zod";

import { ADMIN_LIST_DEFAULT_PAGE_SIZE, ADMIN_LIST_MAX_PAGE_SIZE, adminSearchSchema } from "../admin/admin.js";
import type { ShopStatus } from "../auth/roles.js";
import type { ProductCategory, ProductImageView, ProductStatus, ProductVariantView } from "../products/product.js";
import { plainText } from "../shops/schemas.js";

/**
 * Product moderation (spec 19). An administrator-owned state on each product,
 * separate from the seller's `DRAFT`/`PUBLISHED`/`ARCHIVED` status. Only
 * administrators change it, except the owning seller's resubmission (T4).
 */

/**
 * - `CLEAR`: no restriction (the default). Public per the existing rule.
 * - `RESTRICTED`: hidden by an administrator; the seller must correct it.
 * - `IN_REVIEW`: the seller resubmitted; awaiting an administrator.
 * - `REMOVED`: permanently removed (terminal, PD-9).
 */
export const PRODUCT_MODERATION_STATUSES = ["CLEAR", "RESTRICTED", "IN_REVIEW", "REMOVED"] as const;
export type ProductModerationStatus = (typeof PRODUCT_MODERATION_STATUSES)[number];

/** Seller-facing reason codes, written by the administrator (section 3.2, PD-2). */
export const PRODUCT_MODERATION_REASONS = [
  "COUNTERFEIT",
  "PROHIBITED_ITEM",
  "NOT_NEW",
  "NOT_FASHION",
  "MISLEADING_INFORMATION",
  "INAPPROPRIATE_IMAGES",
  "WRONG_CATEGORY",
  "OTHER",
] as const;
export type ProductModerationReason = (typeof PRODUCT_MODERATION_REASONS)[number];

/** Buyer report reasons (section 4, PD-2). */
export const PRODUCT_REPORT_REASONS = [
  "COUNTERFEIT",
  "PROHIBITED_ITEM",
  "NOT_NEW",
  "NOT_FASHION",
  "MISLEADING_INFORMATION",
  "INAPPROPRIATE_CONTENT",
  "OTHER",
] as const;
export type ProductReportReason = (typeof PRODUCT_REPORT_REASONS)[number];

/** `OPEN`: reported or inspected, product still `CLEAR`. `ACTIVE`: product `RESTRICTED` or `IN_REVIEW`. */
export const MODERATION_CASE_STATUSES = ["OPEN", "ACTIVE", "CLOSED"] as const;
export type ModerationCaseStatus = (typeof MODERATION_CASE_STATUSES)[number];

export const MODERATION_CASE_OUTCOMES = ["DISMISSED", "RESTORED", "REMOVED"] as const;
export type ModerationCaseOutcome = (typeof MODERATION_CASE_OUTCOMES)[number];

export const MODERATION_CASE_SOURCES = ["REPORT", "ADMIN_INSPECTION"] as const;
export type ModerationCaseSource = (typeof MODERATION_CASE_SOURCES)[number];

export const PRODUCT_MODERATION_ACTIONS = [
  "REPORTED",
  "DISMISSED",
  "RESTRICTED",
  "RESUBMITTED",
  "CORRECTION_REQUESTED",
  "RESTORED",
  "REMOVED",
] as const;
export type ProductModerationAction = (typeof PRODUCT_MODERATION_ACTIONS)[number];

/** The actions a seller sees in their product's history: never reports or dismissals. */
export const SELLER_VISIBLE_MODERATION_ACTIONS = [
  "RESTRICTED",
  "RESUBMITTED",
  "CORRECTION_REQUESTED",
  "RESTORED",
  "REMOVED",
] as const satisfies readonly ProductModerationAction[];

export const MODERATION_ACTOR_TYPES = ["BUYER", "SELLER", "ADMIN"] as const;
export type ModerationActorType = (typeof MODERATION_ACTOR_TYPES)[number];

/** Field bounds (section 3.2, section 4), counted after NFC normalization and trimming. */
export const MODERATION_LIMITS = {
  sellerMessageMin: 10,
  sellerMessageMax: 1000,
  internalReasonMin: 10,
  internalReasonMax: 500,
  internalNoteMax: 1000,
  sellerNoteMax: 500,
  reportDetailsMax: 1000,
} as const;

/** Seller notification types (section 6), audience seller, resource `PRODUCT`. */
export const PRODUCT_MODERATION_NOTIFICATION_TYPES = [
  "PRODUCT_RESTRICTED",
  "PRODUCT_CORRECTION_REQUESTED",
  "PRODUCT_RESTORED",
  "PRODUCT_REMOVED",
] as const;
export type ProductModerationNotificationType = (typeof PRODUCT_MODERATION_NOTIFICATION_TYPES)[number];

/** Allowlisted payload: never a report, a reporter, an internal reason or note, or an administrator. */
export interface ProductModerationNotificationPayload {
  productId: string;
  productName: string;
  /** `null` for a restoration. */
  reasonCode: ProductModerationReason | null;
  /** `null` for a restoration without a message. */
  sellerMessage: string | null;
}

/**
 * Stable error codes (section 8.2).
 *
 * - `PRODUCT_MODERATION_CONFLICT` (409): the transition is not allowed from the
 *   current state, its preconditions do not hold, or a concurrent change won.
 * - `PRODUCT_UNDER_REVIEW` (409): seller writes other than stock while `IN_REVIEW`.
 * - `PRODUCT_REMOVED` (409): every seller write once `REMOVED`.
 * - `PRODUCT_REPORT_REASON_INVALID` (400): an unknown report reason, or `OTHER`
 *   without a description.
 * - `CASE_NOT_FOUND` (404).
 * - Plus `PRODUCT_NOT_FOUND` (404) and `SHOP_SELF_ADMINISTRATION_FORBIDDEN` (403).
 */
export const MODERATION_ERROR_CODES = {
  conflict: "PRODUCT_MODERATION_CONFLICT",
  underReview: "PRODUCT_UNDER_REVIEW",
  removed: "PRODUCT_REMOVED",
  reportReasonInvalid: "PRODUCT_REPORT_REASON_INVALID",
  caseNotFound: "CASE_NOT_FOUND",
} as const;

// ---------------------------------------------------------------------------
// Request schemas (every object strict: protected fields fail validation)
// ---------------------------------------------------------------------------

const sellerReasonCode = z.enum(PRODUCT_MODERATION_REASONS);
const sellerMessage = plainText(MODERATION_LIMITS.sellerMessageMin, MODERATION_LIMITS.sellerMessageMax, { multiline: true });
const internalReason = plainText(MODERATION_LIMITS.internalReasonMin, MODERATION_LIMITS.internalReasonMax);
const internalNote = plainText(1, MODERATION_LIMITS.internalNoteMax, { multiline: true });
/**
 * The moderation state the administrator acted on (section 3.2: "a conflicting
 * concurrent change returns 409"). A transition from any other state is
 * refused, so of two racing actions on the same state exactly one applies; a
 * repeat of a completed action still returns the current state (D4).
 */
const expectedStatus = z.enum(PRODUCT_MODERATION_STATUSES);

/** T3 (restrict, first correction request), T5 (further correction request), T7 (remove). */
export const moderationSanctionSchema = z.strictObject({
  expectedStatus,
  sellerReasonCode,
  sellerMessage,
  internalReason,
  internalNote: internalNote.optional(),
});
export type ModerationSanctionInput = z.output<typeof moderationSanctionSchema>;

/** T6 (approve or restore): internal reason, optional seller message. */
export const moderationRestoreSchema = z.strictObject({
  expectedStatus,
  internalReason,
  sellerMessage: sellerMessage.optional(),
  internalNote: internalNote.optional(),
});
export type ModerationRestoreInput = z.output<typeof moderationRestoreSchema>;

/** T2 (dismiss an `OPEN` case). */
export const moderationDismissSchema = z.strictObject({
  internalReason,
  internalNote: internalNote.optional(),
});
export type ModerationDismissInput = z.output<typeof moderationDismissSchema>;

/** T4 (seller resubmission). The body may be empty. */
export const moderationResubmitSchema = z.strictObject({
  note: plainText(1, MODERATION_LIMITS.sellerNoteMax, { multiline: true }).optional(),
});
export type ModerationResubmitInput = z.output<typeof moderationResubmitSchema>;

/**
 * `POST /customers/me/product-reports`. `details` is required with `OTHER`
 * (the S2-4 pattern). An unknown reason or `OTHER` without details →
 * `400 PRODUCT_REPORT_REASON_INVALID`; anything else invalid → `400 BAD_REQUEST`.
 */
export const productReportSchema = z.strictObject({
  productId: z.uuid(),
  reasonCode: z.string().max(40),
  details: plainText(1, MODERATION_LIMITS.reportDetailsMax, { multiline: true }).optional(),
});
export type ProductReportBody = z.output<typeof productReportSchema>;

/** Whether a parsed report body names a valid reason (with its description when `OTHER`). */
export function isValidReportReason(body: { reasonCode: string; details?: string | undefined }): body is { reasonCode: ProductReportReason; details?: string } {
  if (!(PRODUCT_REPORT_REASONS as readonly string[]).includes(body.reasonCode)) return false;
  return body.reasonCode !== "OTHER" || body.details !== undefined;
}

const page = z.coerce.number().int().min(1).max(1_000_000).default(1);
const pageSize = z.coerce.number().int().min(1).max(ADMIN_LIST_MAX_PAGE_SIZE).default(ADMIN_LIST_DEFAULT_PAGE_SIZE);

/** `GET /admin/products`: name or shop name search, shop and moderation filters. */
export const adminProductListQuerySchema = z.strictObject({
  q: adminSearchSchema.optional(),
  shopId: z.uuid().optional(),
  moderationStatus: z.enum(PRODUCT_MODERATION_STATUSES).optional(),
  page,
  pageSize,
});
export type AdminProductListQuery = z.output<typeof adminProductListQuerySchema>;

/**
 * `GET /admin/moderation/cases`. Without `status`, the queue: non-closed cases,
 * `IN_REVIEW` products first, then oldest first. `status=CLOSED` searches
 * closed cases, most recently closed first. `q` matches the product name.
 */
export const adminModerationCaseListQuerySchema = z.strictObject({
  status: z.enum(MODERATION_CASE_STATUSES).optional(),
  moderationStatus: z.enum(PRODUCT_MODERATION_STATUSES).optional(),
  shopId: z.uuid().optional(),
  q: adminSearchSchema.optional(),
  page,
  pageSize,
});
export type AdminModerationCaseListQuery = z.output<typeof adminModerationCaseListQuerySchema>;

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

/**
 * The seller's view of their product's moderation (section 6). The reason and
 * message are the administrator's latest seller-facing ones while the product
 * is not `CLEAR`.
 */
export interface SellerProductModeration {
  status: ProductModerationStatus;
  reasonCode: ProductModerationReason | null;
  message: string | null;
  updatedAt: string | null;
}

/** One entry of the seller-visible history. Administrators are "Chicman" (PD-10). */
export interface SellerModerationHistoryEntry {
  id: string;
  action: (typeof SELLER_VISIBLE_MODERATION_ACTIONS)[number];
  actor: "CHICMAN" | "SELLER";
  reasonCode: ProductModerationReason | null;
  message: string | null;
  /** The seller's own note on a resubmission. */
  note: string | null;
  createdAt: string;
}

/** `GET /sellers/me/products/:productId/moderation`. Oldest first. */
export interface SellerProductModerationResponse {
  productId: string;
  moderation: SellerProductModeration;
  history: SellerModerationHistoryEntry[];
}

/** `POST /customers/me/product-reports`: the buyer sees only that it was sent (PD-4). */
export interface ProductReportReceipt {
  reportId: string;
  productId: string;
  reasonCode: ProductReportReason;
  createdAt: string;
}

/** The allowlisted content an event records (section 8.1). */
export interface ModerationContentSnapshot {
  name: string;
  description: string;
  category: ProductCategory;
  brand: string | null;
  price: string;
  variants: { size: string | null; color: string | null; stock: number }[];
  imageKeys: string[];
}

export interface AdminModerationEvent {
  id: string;
  caseId: string;
  action: ProductModerationAction;
  fromStatus: ProductModerationStatus | null;
  toStatus: ProductModerationStatus | null;
  actorType: ModerationActorType;
  actorUserId: string;
  sellerReasonCode: ProductModerationReason | null;
  sellerMessage: string | null;
  sellerNote: string | null;
  internalReason: string | null;
  internalNote: string | null;
  contentSnapshot: ModerationContentSnapshot;
  createdAt: string;
}

export interface AdminModerationCaseSummary {
  id: string;
  productId: string;
  productName: string;
  productModerationStatus: ProductModerationStatus;
  shopId: string;
  shopName: string;
  status: ModerationCaseStatus;
  outcome: ModerationCaseOutcome | null;
  source: ModerationCaseSource;
  reportCount: number;
  openedAt: string;
  closedAt: string | null;
}

export interface AdminModerationCaseListResponse {
  cases: AdminModerationCaseSummary[];
  page: number;
  pageSize: number;
  total: number;
}

/** Reporter account ID only, never a name or phone (PD-10). */
export interface AdminProductReport {
  id: string;
  reasonCode: ProductReportReason;
  details: string | null;
  reporterUserId: string;
  createdAt: string;
}

/** Earlier cases, for repeated violations (section 5). */
export interface ModerationCaseCounts {
  total: number;
  dismissed: number;
  restored: number;
  removed: number;
}

export interface AdminProductListItem {
  id: string;
  name: string;
  price: string;
  status: ProductStatus;
  moderationStatus: ProductModerationStatus;
  moderationUpdatedAt: string | null;
  mainImageUrl: string | null;
  shop: { id: string; name: string; status: ShopStatus };
  createdAt: string;
  updatedAt: string;
}

export interface AdminProductListResponse {
  products: AdminProductListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface AdminProductContent {
  name: string;
  description: string;
  category: ProductCategory;
  brand: string | null;
  price: string;
  images: ProductImageView[];
  variants: ProductVariantView[];
}

/** `GET /admin/products/:productId`. */
export interface AdminProductDetail {
  id: string;
  status: ProductStatus;
  moderationStatus: ProductModerationStatus;
  moderationUpdatedAt: string | null;
  content: AdminProductContent;
  stock: number;
  shop: { id: string; name: string; status: ShopStatus; ownerUserId: string };
  /** The administrator owns this shop: every moderation action is refused (`403`). */
  selfAdministered: boolean;
  /** The non-closed case, if any. */
  openCase: AdminModerationCaseSummary | null;
  /** Closed cases of this product and of its shop. */
  priorCases: { product: ModerationCaseCounts; shop: ModerationCaseCounts };
  /** Every event of every case, oldest first. */
  history: AdminModerationEvent[];
  createdAt: string;
  updatedAt: string;
}

/** `GET /admin/moderation/cases/:caseId`. */
export interface AdminModerationCaseDetail {
  case: AdminModerationCaseSummary;
  /** The content when the case opened, beside the current content. */
  snapshot: ModerationContentSnapshot | null;
  product: AdminProductDetail;
  reports: AdminProductReport[];
  /** This case's events, oldest first. */
  events: AdminModerationEvent[];
}
