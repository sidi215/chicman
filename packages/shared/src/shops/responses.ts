import type { ShopStatus } from "../auth/roles.js";
import type {
  LogoContentType,
  ShopChangeRequestStatus,
  ShopDecisionType,
  ShopField,
  ShopFieldChangeSource,
} from "./constants.js";

/** Latest administrative shop decision, without any reason. */
export interface ShopLatestDecision {
  type: ShopDecisionType;
  decidedAt: string;
}

/** The owner-visible explanation of an initial application rejection. */
export interface ShopRejection {
  applicantReason: string;
  rejectedAt: string;
}

/** The latest `shopName`/`city` change request, without any reason. */
export interface OwnerShopChangeRequest {
  id: string;
  proposedShopName: string | null;
  proposedCity: string | null;
  status: ShopChangeRequestStatus;
  submittedAt: string;
  decidedAt: string | null;
}

/**
 * `GET /api/v1/sellers/me/shop` (and the other owner shop responses).
 * Built from an explicit allowlist: it never carries internal reasons,
 * internal notes, administrator identities, or other audit metadata.
 */
export interface OwnerShopResponse {
  id: string;
  status: ShopStatus;
  shopName: string;
  description: string;
  contactPhone: string;
  whatsappPhone: string | null;
  city: string;
  address: string;
  logoUrl: string | null;
  /** Decimal string in MRU; `null` until the seller sets it (D2). */
  deliveryFee: string | null;
  createdAt: string;
  updatedAt: string;
  /** `null` before the first administrative decision. */
  latestDecision: ShopLatestDecision | null;
  /** Present only while `status = REJECTED`. */
  rejection: ShopRejection | null;
  changeRequest: OwnerShopChangeRequest | null;
}

/** `POST /api/v1/sellers/me/shop/logo/uploads` response. */
export interface LogoUploadResponse {
  uploadId: string;
  uploadUrl: string;
  method: "PUT";
  headers: { "Content-Type": LogoContentType; "Content-Length": string };
  expiresAt: string;
}

/** `POST /api/v1/sellers/me/shop/logo/uploads/:uploadId/complete` response. */
export interface LogoCompleteResponse {
  logoUrl: string;
}

/** Administrator views (`/api/v1/admin/shops`). Never returned to owners. */
export interface AdminShopSummary {
  id: string;
  ownerUserId: string;
  status: ShopStatus;
  shopName: string;
  city: string;
  createdAt: string;
  updatedAt: string;
  hasOpenChangeRequest: boolean;
}

export interface AdminShopListResponse {
  shops: AdminShopSummary[];
}

export interface AdminShopStatusEvent {
  id: string;
  fromStatus: ShopStatus | null;
  toStatus: ShopStatus;
  actorUserId: string;
  decisionType: ShopDecisionType | null;
  internalReason: string | null;
  applicantReason: string | null;
  internalNote: string | null;
  createdAt: string;
}

export interface AdminShopFieldChange {
  id: string;
  field: ShopField;
  oldValue: string | null;
  newValue: string | null;
  actorUserId: string;
  source: ShopFieldChangeSource;
  createdAt: string;
}

export interface AdminShopChangeRequest {
  id: string;
  proposedShopName: string | null;
  proposedCity: string | null;
  status: ShopChangeRequestStatus;
  submittedByUserId: string;
  submittedAt: string;
  decidedByUserId: string | null;
  decidedAt: string | null;
  internalReason: string | null;
  internalNote: string | null;
}

export interface AdminShopDetailResponse {
  shop: Omit<OwnerShopResponse, "latestDecision" | "rejection" | "changeRequest"> & { ownerUserId: string };
  statusEvents: AdminShopStatusEvent[];
  fieldChanges: AdminShopFieldChange[];
  changeRequests: AdminShopChangeRequest[];
}
