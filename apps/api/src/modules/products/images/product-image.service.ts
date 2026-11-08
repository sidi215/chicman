import { randomUUID } from "node:crypto";

import {
  API_ERROR_CODES,
  PRODUCT_ERROR_CODES,
  PRODUCT_IMAGE_MAX_UPLOAD_BYTES,
  PRODUCT_IMAGE_REJECTION_CODES,
  PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
  PRODUCT_MAX_IMAGES,
  type ProductImageUploadRequestInput,
  type ProductImageUploadResponse,
  type SellerProductDetail,
} from "@chicman/shared";

import type { LogoTimingConfig } from "../../../config/env.js";
import { describeError } from "../../../lib/describe-error.js";
import { forbidden, HttpError, notFound } from "../../../lib/http-error.js";
import type { PrismaClient } from "../../../lib/prisma.js";
import type { ObjectStorage } from "../../shops/logo/object-storage.js";
import { isShopStillApproved, lockProduct, productArchived, productNotFound, touchProduct, type ProductSeller } from "../product-lock.js";
import { loadProductDetail, mediaUrlBuilder, type MediaUrl } from "../product-views.js";
import { imageProcessing } from "../../media/index.js";
import { normalizeProductImage, type ProductImageNormalization } from "./image-normalizer.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Test-only fault injection points. */
export interface ProductImageServiceFaults {
  /** After a won claim, before reading the staged object. */
  afterClaim?: (attempt: number) => void | Promise<void>;
  /** After the public object is written, before the commit transaction. */
  beforeCommit?: (attempt: number) => void | Promise<void>;
}

export interface ProductImageServiceOptions {
  prisma: PrismaClient;
  storage: ObjectStorage;
  timing: LogoTimingConfig;
  mediaPublicBaseUrl: string;
  faults?: ProductImageServiceFaults;
  log?: (line: string) => void;
}

/** The commit lost its fence: a newer attempt or the cleanup job owns the upload. */
class StaleAttemptError extends Error {}
/** The new image was reclaimed by the cleanup job before the commit. */
class ImageReclaimedError extends Error {}
/** The shop is no longer approved. */
class ShopNotEligibleError extends Error {}
/** The product was archived (or is gone) since the upload began. */
class ProductNotEditableError extends Error {}
/** The product reached its image limit since the upload began. */
class ImageLimitError extends Error {}

interface ClaimedUpload {
  attempt: number;
  stagingKey: string;
  declaredContentType: string;
}

const uploadNotFound = (): HttpError => notFound(PRODUCT_ERROR_CODES.imageUploadNotFound);
const inProgress = (): HttpError => new HttpError(409, PRODUCT_ERROR_CODES.imageCompletionInProgress);
const expired = (): HttpError => new HttpError(410, PRODUCT_ERROR_CODES.imageUploadExpired);
const storageUnavailable = (): HttpError => new HttpError(503, PRODUCT_ERROR_CODES.imageStorageUnavailable);
const limitReached = (): HttpError => new HttpError(409, PRODUCT_ERROR_CODES.imageLimitReached);

/**
 * Product image upload (spec 07, section 5), with the security and recovery
 * rules of the shop logo flow (spec 06): presigned PUT into the private
 * staging bucket, then an idempotent, lease-fenced completion that verifies
 * the real content, normalizes it (size, orientation, no metadata), writes the
 * result to a new immutable media key under this product, and commits it in
 * one transaction. The uploaded original is never public.
 */
export class ProductImageService {
  private readonly prisma: PrismaClient;
  private readonly storage: ObjectStorage;
  private readonly timing: LogoTimingConfig;
  private readonly mediaUrl: MediaUrl;
  private readonly faults: ProductImageServiceFaults;
  private readonly log: (line: string) => void;

  constructor(options: ProductImageServiceOptions) {
    this.prisma = options.prisma;
    this.storage = options.storage;
    this.timing = options.timing;
    this.mediaUrl = mediaUrlBuilder(options.mediaPublicBaseUrl);
    this.faults = options.faults ?? {};
    this.log = options.log ?? ((line) => console.warn(line));
  }

  /** Records the upload and returns a presigned PUT for its staging key. */
  async requestUpload(seller: ProductSeller, productId: string, input: ProductImageUploadRequestInput): Promise<ProductImageUploadResponse> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, shopId: seller.shopId }, select: { status: true } });
    if (product === null) throw productNotFound();
    if (product.status === "ARCHIVED") throw productArchived();
    const active = await this.prisma.productImage.count({ where: { productId, status: "ACTIVE" } });
    if (active >= PRODUCT_MAX_IMAGES) throw limitReached();

    const uploadId = randomUUID();
    // The client never chooses a key.
    const stagingKey = `product-images/${seller.shopId}/${productId}/${uploadId}`;
    const rows = await this.prisma.$queryRaw<{ expiresAt: Date }[]>`
      INSERT INTO "ProductImageUpload"
        ("id", "productId", "stagingKey", "declaredContentType", "declaredSize", "status", "attempt",
         "expiresAt", "completeBy", "createdAt", "updatedAt")
      VALUES (
        ${uploadId}::uuid, ${productId}::uuid, ${stagingKey}, ${input.contentType}, ${input.contentLength},
        'PENDING', 0,
        now() + make_interval(secs => ${PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS}),
        now() + make_interval(secs => ${PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS}) + make_interval(secs => ${this.timing.completionWindowMs / 1000}),
        now(), now()
      )
      RETURNING "expiresAt"`;
    const uploadUrl = await this.storage.presignStagingPut(
      stagingKey,
      input.contentType,
      input.contentLength,
      PRODUCT_IMAGE_UPLOAD_URL_TTL_SECONDS,
    );
    return {
      uploadId,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": input.contentType, "Content-Length": String(input.contentLength) },
      expiresAt: (rows[0]?.expiresAt ?? new Date()).toISOString(),
    };
  }

  /** Completes an upload (idempotent) and returns the updated product. */
  async complete(seller: ProductSeller, productId: string, uploadId: string): Promise<SellerProductDetail> {
    if (!UUID.test(uploadId)) throw uploadNotFound();
    const product = await this.prisma.product.findFirst({ where: { id: productId, shopId: seller.shopId }, select: { status: true } });
    if (product === null) throw productNotFound();
    if (product.status === "ARCHIVED") throw productArchived();

    const claim = await this.claim(uploadId, productId);
    if (claim === null) return this.currentState(seller, productId, uploadId);
    const { attempt } = claim;
    await this.faults.afterClaim?.(attempt);

    // Verified and normalized on every attempt.
    let verdict: ProductImageNormalization | null;
    try {
      verdict = await imageProcessing.run(() => this.readAndNormalize(claim.stagingKey, claim.declaredContentType));
    } catch (error) {
      this.log(`Product image staging read failed: ${describeError(error)}`);
      if (!(await this.returnToPending(uploadId, attempt, PRODUCT_ERROR_CODES.imageStorageUnavailable))) {
        return this.currentState(seller, productId, uploadId);
      }
      throw storageUnavailable();
    }
    if (verdict === null) {
      // Retryable: back to PENDING.
      if (!(await this.returnToPending(uploadId, attempt, PRODUCT_ERROR_CODES.imageNotUploaded))) {
        return this.currentState(seller, productId, uploadId);
      }
      throw new HttpError(422, PRODUCT_ERROR_CODES.imageNotUploaded);
    }
    if (!verdict.ok) {
      const { code } = verdict;
      if (!(await this.reject(uploadId, attempt, code))) return this.currentState(seller, productId, uploadId);
      this.cleanupStagingInBackground(uploadId, claim.stagingKey);
      throw new HttpError(422, code);
    }
    const { bytes } = verdict;

    // Recorded before it is written, so the object can always be reconciled.
    // The key is new and lives under this product: no other object is overwritten.
    const imageId = randomUUID();
    const objectKey = `product-images/${seller.shopId}/${productId}/${uploadId}/${imageId}.${verdict.extension}`;
    await this.prisma.productImage.create({
      data: {
        id: imageId,
        productId,
        uploadId,
        attempt,
        objectKey,
        contentType: verdict.contentType,
        sizeBytes: bytes.byteLength,
        width: verdict.width,
        height: verdict.height,
        status: "PENDING",
      },
    });

    // The normalized bytes held in memory, never a copy of the staging key.
    try {
      await this.storage.putMedia(objectKey, bytes, verdict.contentType);
    } catch (error) {
      // The write may still have happened (timeout): the row is released and
      // reconciliation deletes the key.
      this.log(`Product image media write failed: ${describeError(error)}`);
      const released = await this.releaseImage(imageId);
      if (!(await this.returnToPending(uploadId, attempt, PRODUCT_ERROR_CODES.imageStorageUnavailable))) {
        if (released) await this.deleteOwnObject(imageId, objectKey);
        return this.currentState(seller, productId, uploadId);
      }
      throw storageUnavailable();
    }

    try {
      await this.faults.beforeCommit?.(attempt);
      await this.commit(seller, productId, uploadId, attempt, imageId);
    } catch (error) {
      return this.recoverFailedCommit(error, seller, productId, uploadId, attempt, imageId, objectKey);
    }

    // Staging cleanup never affects the result.
    this.cleanupStagingInBackground(uploadId, claim.stagingKey);
    return loadProductDetail(this.prisma, seller, productId, this.mediaUrl);
  }

  /** `null`: nothing was uploaded yet. Storage failures throw. */
  private async readAndNormalize(stagingKey: string, declaredContentType: string): Promise<ProductImageNormalization | null> {
    const staged = await this.storage.readStaging(stagingKey, PRODUCT_IMAGE_MAX_UPLOAD_BYTES);
    if (staged.kind === "missing") return null;
    if (staged.kind === "tooLarge") return { ok: false, code: "PRODUCT_IMAGE_TOO_LARGE" };
    return normalizeProductImage(staged.bytes, declaredContentType);
  }

  /** Conditional claim: only one request can win it. */
  private async claim(uploadId: string, productId: string): Promise<ClaimedUpload | null> {
    const rows = await this.prisma.$queryRaw<ClaimedUpload[]>`
      UPDATE "ProductImageUpload"
      SET "status" = 'PROCESSING', "attempt" = "attempt" + 1,
          "leaseExpiresAt" = now() + make_interval(secs => ${this.timing.completionLeaseMs / 1000}),
          "updatedAt" = now()
      WHERE "id" = ${uploadId}::uuid AND "productId" = ${productId}::uuid AND now() <= "completeBy"
        AND ("status" = 'PENDING' OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < now()))
      RETURNING "attempt", "stagingKey", "declaredContentType"`;
    return rows[0] ?? null;
  }

  /** One transaction: fenced completion first, then the shop and product locks, then the image. */
  private async commit(seller: ProductSeller, productId: string, uploadId: string, attempt: number, imageId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const completed = await tx.$executeRaw`
        UPDATE "ProductImageUpload"
        SET "status" = 'COMPLETED', "resultImageId" = ${imageId}::uuid, "completedAt" = now(),
            "leaseExpiresAt" = NULL, "lastErrorCode" = NULL, "updatedAt" = now()
        WHERE "id" = ${uploadId}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${attempt}`;
      if (completed !== 1) throw new StaleAttemptError();

      if (!(await isShopStillApproved(tx, seller.shopId))) throw new ShopNotEligibleError();
      const product = await lockProduct(tx, seller.shopId, productId);
      if (product === null || product.status === "ARCHIVED") throw new ProductNotEditableError();

      const active = await tx.productImage.aggregate({
        where: { productId, status: "ACTIVE" },
        _count: { _all: true },
        _max: { position: true },
      });
      if (active._count._all >= PRODUCT_MAX_IMAGES) throw new ImageLimitError();
      const position = (active._max.position ?? -1) + 1;

      // Fails if the cleanup job reclaimed the image.
      const activated = await tx.$executeRaw`
        UPDATE "ProductImage" SET "status" = 'ACTIVE', "position" = ${position}
        WHERE "id" = ${imageId}::uuid AND "status" = 'PENDING'`;
      if (activated !== 1) throw new ImageReclaimedError();
      await touchProduct(tx, productId);
    });
  }

  private async recoverFailedCommit(
    error: unknown,
    seller: ProductSeller,
    productId: string,
    uploadId: string,
    attempt: number,
    imageId: string,
    objectKey: string,
  ): Promise<SellerProductDetail> {
    if (error instanceof StaleAttemptError) {
      // Only this attempt's own object is cleaned up.
      if (await this.releaseImage(imageId)) await this.deleteOwnObject(imageId, objectKey);
      return this.currentState(seller, productId, uploadId);
    }
    if (error instanceof ImageLimitError) {
      if (await this.releaseImage(imageId)) await this.deleteOwnObject(imageId, objectKey);
      if (!(await this.reject(uploadId, attempt, PRODUCT_ERROR_CODES.imageLimitReached))) {
        return this.currentState(seller, productId, uploadId);
      }
      throw limitReached();
    }
    if (error instanceof ImageReclaimedError || error instanceof ShopNotEligibleError || error instanceof ProductNotEditableError) {
      if (await this.releaseImage(imageId)) await this.deleteOwnObject(imageId, objectKey);
      const code = error instanceof ImageReclaimedError ? "LEASE_EXPIRED" : "NOT_ELIGIBLE";
      const returned = await this.returnToPending(uploadId, attempt, code);
      if (returned && error instanceof ShopNotEligibleError) throw forbidden();
      if (returned && error instanceof ProductNotEditableError) throw productArchived();
      return this.currentState(seller, productId, uploadId);
    }
    // A database error after the write. Only a released row has its bytes
    // deleted: the commit may in fact have succeeded (the image is ACTIVE).
    this.log(`Product image completion commit failed: ${describeError(error)}`);
    try {
      if (await this.releaseImage(imageId)) await this.deleteOwnObject(imageId, objectKey);
      if (!(await this.returnToPending(uploadId, attempt, "DATABASE_ERROR"))) {
        return this.currentState(seller, productId, uploadId);
      }
    } catch (cleanupError) {
      // The rows identify the orphan; reconciliation handles it.
      this.log(`Product image completion recovery failed: ${describeError(cleanupError)}`);
    }
    throw new HttpError(503, API_ERROR_CODES.serviceUnavailable);
  }

  /** Fenced return to `PENDING`. `false`: the attempt is stale and nothing changed. */
  private async returnToPending(uploadId: string, attempt: number, code: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "ProductImageUpload"
      SET "status" = 'PENDING', "lastErrorCode" = ${code}, "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${uploadId}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${attempt}`;
    return updated === 1;
  }

  /** Fenced terminal rejection. `false`: the attempt is stale and nothing changed. */
  private async reject(uploadId: string, attempt: number, code: string): Promise<boolean> {
    const rejected = await this.prisma.$executeRaw`
      UPDATE "ProductImageUpload"
      SET "status" = 'REJECTED', "rejectionCode" = ${code}, "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${uploadId}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${attempt}`;
    return rejected === 1;
  }

  /** Marks this attempt's own image `RELEASED` (never an `ACTIVE` one). `false`: no row was released. */
  private async releaseImage(imageId: string): Promise<boolean> {
    const released = await this.prisma.$executeRaw`
      UPDATE "ProductImage" SET "status" = 'RELEASED', "releasedAt" = now()
      WHERE "id" = ${imageId}::uuid AND "status" = 'PENDING'`;
    return released === 1;
  }

  /** Compensating delete of this attempt's own, released object; on failure reconciliation retries. */
  private async deleteOwnObject(imageId: string, objectKey: string): Promise<void> {
    try {
      await this.storage.deleteMedia(objectKey);
    } catch (error) {
      this.log(`Product image compensating delete failed: ${describeError(error)}`);
      await this.prisma.$executeRaw`
        UPDATE "ProductImage" SET "deleteAttempts" = "deleteAttempts" + 1, "lastDeleteError" = 'COMPENSATING_DELETE_FAILED'
        WHERE "id" = ${imageId}::uuid AND "status" = 'RELEASED'`;
      return;
    }
    await this.prisma.$executeRaw`
      UPDATE "ProductImage" SET "status" = 'DELETED', "deletedAt" = now()
      WHERE "id" = ${imageId}::uuid AND "status" = 'RELEASED'`;
  }

  /** The authoritative state of an upload, as a response (unwon claim or stale attempt). */
  private async currentState(seller: ProductSeller, productId: string, uploadId: string): Promise<SellerProductDetail> {
    const rows = await this.prisma.$queryRaw<
      { status: string; rejectionCode: string | null; imageStatus: string | null; pastCompleteBy: boolean; leaseLive: boolean }[]
    >`
      SELECT u."status"::text AS "status", u."rejectionCode", i."status"::text AS "imageStatus",
             now() > u."completeBy" AS "pastCompleteBy",
             (u."leaseExpiresAt" IS NOT NULL AND u."leaseExpiresAt" >= now()) AS "leaseLive"
      FROM "ProductImageUpload" u LEFT JOIN "ProductImage" i ON i."id" = u."resultImageId"
      WHERE u."id" = ${uploadId}::uuid AND u."productId" = ${productId}::uuid`;
    const upload = rows[0];
    // Another product's upload is not disclosed.
    if (upload === undefined) throw uploadNotFound();
    switch (upload.status) {
      case "COMPLETED":
        // The image was removed since: this upload no longer has a result.
        if (upload.imageStatus !== "ACTIVE") throw expired();
        return loadProductDetail(this.prisma, seller, productId, this.mediaUrl);
      case "REJECTED":
        if (upload.rejectionCode === PRODUCT_ERROR_CODES.imageLimitReached) throw limitReached();
        throw new HttpError(422, PRODUCT_IMAGE_REJECTION_CODES.find((code) => code === upload.rejectionCode) ?? "PRODUCT_IMAGE_INVALID");
      case "EXPIRED":
        throw expired();
      case "PROCESSING":
        if (upload.leaseLive) throw inProgress();
        if (upload.pastCompleteBy) throw expired();
        throw inProgress();
      default:
        if (upload.pastCompleteBy) throw expired();
        // PENDING after a lost race: the client retries.
        throw inProgress();
    }
  }

  /** Best effort; the cleanup job retries until `stagingDeletedAt` is set. */
  private cleanupStagingInBackground(uploadId: string, stagingKey: string): void {
    void (async () => {
      try {
        await this.storage.deleteStaging(stagingKey);
        await this.prisma.$executeRaw`
          UPDATE "ProductImageUpload" SET "stagingDeletedAt" = now()
          WHERE "id" = ${uploadId}::uuid AND "status" IN ('COMPLETED', 'REJECTED', 'EXPIRED') AND "stagingDeletedAt" IS NULL`;
      } catch {
        // Retried by the cleanup job.
      }
    })();
  }
}
