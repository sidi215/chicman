import { randomUUID } from "node:crypto";

import {
  API_ERROR_CODES,
  AUTH_ERROR_CODES,
  LOGO_MAX_UPLOAD_BYTES,
  LOGO_UPLOAD_URL_TTL_SECONDS,
  SHOP_ERROR_CODES,
  type LogoCompleteResponse,
  type LogoUploadRequestInput,
  type LogoUploadResponse,
  type Role,
  type ShopStatus,
} from "@chicman/shared";

import type { LogoTimingConfig } from "../../../config/env.js";
import { describeError } from "../../../lib/describe-error.js";
import { forbidden, HttpError, notFound } from "../../../lib/http-error.js";
import type { PrismaClient } from "../../../lib/prisma.js";
import { isShopOperationAllowed } from "../shop-policy.js";
import { lockShopById } from "../shop.service.js";
import { imageProcessing } from "../../media/index.js";
import { normalizeLogo, type LogoNormalization } from "./logo-normalizer.js";
import type { ObjectStorage } from "./object-storage.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The owner's shop as resolved by the onboarding guard. */
export interface LogoOwner {
  userId: string;
  roles: Role[];
  shopId: string;
}

/** Test-only fault injection points (spec 06, Failure injection). */
export interface LogoServiceFaults {
  /** After a won claim, before reading the staged object. */
  afterClaim?: (attempt: number) => void | Promise<void>;
  /** After the public object is written, before the commit transaction. */
  beforeCommit?: (attempt: number) => void | Promise<void>;
  /** Inside the commit transaction, after the previous logo is released. */
  afterReleasePrevious?: () => void | Promise<void>;
}

export interface LogoServiceOptions {
  prisma: PrismaClient;
  storage: ObjectStorage;
  timing: LogoTimingConfig;
  mediaPublicBaseUrl: string;
  faults?: LogoServiceFaults;
  log?: (line: string) => void;
}

/** The commit lost its fence: a newer attempt or the cleanup job owns the upload. */
class StaleAttemptError extends Error {}
/** The new object was reclaimed by the cleanup job before the commit. */
class ObjectReclaimedError extends Error {}
/** The shop may no longer change its logo (for example it was suspended meanwhile). */
class ShopNotEligibleError extends Error {}

interface ClaimedUpload {
  attempt: number;
  stagingKey: string;
  declaredContentType: string;
}

const uploadNotFound = (): HttpError => notFound(SHOP_ERROR_CODES.logoUploadNotFound);
const inProgress = (): HttpError => new HttpError(409, SHOP_ERROR_CODES.logoCompletionInProgress);
const storageUnavailable = (): HttpError => new HttpError(503, SHOP_ERROR_CODES.logoStorageUnavailable);

/**
 * Shop logo upload (spec 06, Shop logo upload): presigned PUT into the
 * private staging bucket, then an idempotent, lease-fenced completion that
 * verifies and normalizes the content (size, orientation, no metadata), writes
 * the result to a new immutable media key, and commits `Shop.logoUrl` in one
 * transaction. The uploaded original is never public.
 */
export class LogoService {
  private readonly prisma: PrismaClient;
  private readonly storage: ObjectStorage;
  private readonly timing: LogoTimingConfig;
  private readonly baseUrl: string;
  private readonly faults: LogoServiceFaults;
  private readonly log: (line: string) => void;

  constructor(options: LogoServiceOptions) {
    this.prisma = options.prisma;
    this.storage = options.storage;
    this.timing = options.timing;
    this.baseUrl = options.mediaPublicBaseUrl.replace(/\/+$/, "");
    this.faults = options.faults ?? {};
    this.log = options.log ?? ((line) => console.warn(line));
  }

  /** Public URL of a media key. */
  publicUrl(objectKey: string): string {
    return `${this.baseUrl}/${objectKey}`;
  }

  /** Steps 1–3: record the upload and return a presigned PUT for its staging key. */
  async requestUpload(owner: LogoOwner, input: LogoUploadRequestInput): Promise<LogoUploadResponse> {
    const uploadId = randomUUID();
    // The client never chooses a key.
    const stagingKey = `shop-logos/${owner.shopId}/${uploadId}`;
    const rows = await this.prisma.$queryRaw<{ expiresAt: Date }[]>`
      INSERT INTO "ShopLogoUpload"
        ("id", "shopId", "stagingKey", "declaredContentType", "declaredSize", "status", "attempt",
         "expiresAt", "completeBy", "createdAt", "updatedAt")
      VALUES (
        ${uploadId}::uuid, ${owner.shopId}::uuid, ${stagingKey}, ${input.contentType}, ${input.contentLength},
        'PENDING', 0,
        now() + make_interval(secs => ${LOGO_UPLOAD_URL_TTL_SECONDS}),
        now() + make_interval(secs => ${LOGO_UPLOAD_URL_TTL_SECONDS}) + make_interval(secs => ${this.timing.completionWindowMs / 1000}),
        now(), now()
      )
      RETURNING "expiresAt"`;
    const uploadUrl = await this.storage.presignStagingPut(
      stagingKey,
      input.contentType,
      input.contentLength,
      LOGO_UPLOAD_URL_TTL_SECONDS,
    );
    return {
      uploadId,
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": input.contentType, "Content-Length": String(input.contentLength) },
      expiresAt: (rows[0]?.expiresAt ?? new Date()).toISOString(),
    };
  }

  /** Step 5: complete an upload (idempotent). */
  async complete(owner: LogoOwner, uploadId: string): Promise<LogoCompleteResponse> {
    if (!UUID.test(uploadId)) throw uploadNotFound();

    // 5.2 Claim.
    const claim = await this.claim(uploadId, owner.shopId);
    if (claim === null) return this.currentState(uploadId, owner.shopId);
    const { attempt } = claim;
    await this.faults.afterClaim?.(attempt);

    // 5.3 Verify and normalize, on every attempt.
    let verdict: LogoNormalization | null;
    try {
      verdict = await imageProcessing.run(() => this.readAndNormalize(claim.stagingKey, claim.declaredContentType));
    } catch (error) {
      this.log(`Logo staging read failed: ${describeError(error)}`);
      if (!(await this.returnToPending(uploadId, attempt, SHOP_ERROR_CODES.logoStorageUnavailable))) {
        return this.currentState(uploadId, owner.shopId);
      }
      throw storageUnavailable();
    }
    if (verdict === null) {
      // Retryable: back to PENDING.
      if (!(await this.returnToPending(uploadId, attempt, SHOP_ERROR_CODES.logoNotUploaded))) {
        return this.currentState(uploadId, owner.shopId);
      }
      throw new HttpError(422, SHOP_ERROR_CODES.logoNotUploaded);
    }
    if (!verdict.ok) {
      const rejected = await this.prisma.$executeRaw`
        UPDATE "ShopLogoUpload"
        SET "status" = 'REJECTED', "rejectionCode" = ${verdict.code}, "leaseExpiresAt" = NULL, "updatedAt" = now()
        WHERE "id" = ${uploadId}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${attempt}`;
      if (rejected !== 1) return this.currentState(uploadId, owner.shopId);
      this.cleanupStagingInBackground(uploadId, claim.stagingKey);
      throw new HttpError(422, verdict.code);
    }
    const { bytes } = verdict;

    // 5.4 Record the public object before writing it.
    const objectId = randomUUID();
    const objectKey = `shop-logos/${owner.shopId}/${uploadId}/${objectId}.${verdict.extension}`;
    await this.prisma.shopLogoObject.create({
      data: { id: objectId, shopId: owner.shopId, uploadId, attempt, objectKey, status: "PENDING" },
    });

    // 5.5 Write the normalized bytes held in memory (never a copy of the staging key).
    try {
      await this.storage.putMedia(objectKey, bytes, verdict.contentType);
    } catch (error) {
      // Case A. The write may still have happened (timeout): the row is
      // released and reconciliation deletes the key.
      this.log(`Logo media write failed: ${describeError(error)}`);
      const released = await this.releaseObject(objectId);
      if (!(await this.returnToPending(uploadId, attempt, SHOP_ERROR_CODES.logoStorageUnavailable))) {
        if (released) await this.deleteOwnObject(objectId, objectKey);
        return this.currentState(uploadId, owner.shopId);
      }
      throw storageUnavailable();
    }

    // 5.6 Commit.
    let logoUrl: string;
    try {
      await this.faults.beforeCommit?.(attempt);
      logoUrl = await this.commit(owner, uploadId, attempt, objectId, objectKey);
    } catch (error) {
      if (error instanceof StaleAttemptError) {
        // Case D: only this attempt's own object is cleaned up.
        if (await this.releaseObject(objectId)) await this.deleteOwnObject(objectId, objectKey);
        return this.currentState(uploadId, owner.shopId);
      }
      if (error instanceof ObjectReclaimedError || error instanceof ShopNotEligibleError) {
        if (await this.releaseObject(objectId)) await this.deleteOwnObject(objectId, objectKey);
        const code = error instanceof ObjectReclaimedError ? "LEASE_EXPIRED" : AUTH_ERROR_CODES.forbidden;
        const returned = await this.returnToPending(uploadId, attempt, code);
        if (error instanceof ShopNotEligibleError && returned) throw forbidden();
        return this.currentState(uploadId, owner.shopId);
      }
      // Case B: a database error after the write. Nothing references the
      // object; compensate, and return the upload to PENDING (fenced). No row
      // released: the commit may have succeeded (the object is ACTIVE) or the
      // job reclaimed it, so its bytes are not deleted here.
      this.log(`Logo completion commit failed: ${describeError(error)}`);
      try {
        if (await this.releaseObject(objectId)) await this.deleteOwnObject(objectId, objectKey);
        const returned = await this.returnToPending(uploadId, attempt, "DATABASE_ERROR");
        if (!returned) return this.currentState(uploadId, owner.shopId);
      } catch (cleanupError) {
        // Case C: the rows identify the orphan; reconciliation handles it.
        this.log(`Logo completion recovery failed: ${describeError(cleanupError)}`);
      }
      throw new HttpError(503, API_ERROR_CODES.serviceUnavailable);
    }

    // 5.7 Staging cleanup never affects the result.
    this.cleanupStagingInBackground(uploadId, claim.stagingKey);
    return { logoUrl };
  }

  /** `null`: nothing was uploaded yet. Storage failures throw. */
  private async readAndNormalize(stagingKey: string, declaredContentType: string): Promise<LogoNormalization | null> {
    const staged = await this.storage.readStaging(stagingKey, LOGO_MAX_UPLOAD_BYTES);
    if (staged.kind === "missing") return null;
    if (staged.kind === "tooLarge") return { ok: false, code: "LOGO_TOO_LARGE" };
    return normalizeLogo(staged.bytes, declaredContentType);
  }

  /** Conditional claim: only one request can win it. */
  private async claim(uploadId: string, shopId: string): Promise<ClaimedUpload | null> {
    const rows = await this.prisma.$queryRaw<ClaimedUpload[]>`
      UPDATE "ShopLogoUpload"
      SET "status" = 'PROCESSING', "attempt" = "attempt" + 1,
          "leaseExpiresAt" = now() + make_interval(secs => ${this.timing.completionLeaseMs / 1000}),
          "updatedAt" = now()
      WHERE "id" = ${uploadId}::uuid AND "shopId" = ${shopId}::uuid AND now() <= "completeBy"
        AND ("status" = 'PENDING' OR ("status" = 'PROCESSING' AND "leaseExpiresAt" < now()))
      RETURNING "attempt", "stagingKey", "declaredContentType"`;
    return rows[0] ?? null;
  }

  /** Step 6: one transaction, in the order required by the partial unique index. */
  private async commit(owner: LogoOwner, uploadId: string, attempt: number, objectId: string, objectKey: string): Promise<string> {
    const logoUrl = this.publicUrl(objectKey);
    await this.prisma.$transaction(async (tx) => {
      // 6.1 Fenced completion first: a stale attempt stops before touching logo state.
      const completed = await tx.$executeRaw`
        UPDATE "ShopLogoUpload"
        SET "status" = 'COMPLETED', "resultObjectId" = ${objectId}::uuid, "completedAt" = now(),
            "leaseExpiresAt" = NULL, "lastErrorCode" = NULL, "updatedAt" = now()
        WHERE "id" = ${uploadId}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${attempt}`;
      if (completed !== 1) throw new StaleAttemptError();

      const shop = await lockShopById(tx, owner.shopId);
      if (shop === null || !isShopOperationAllowed("logo", shop.status as ShopStatus, owner.roles)) {
        throw new ShopNotEligibleError();
      }

      // 6.2 Release the previous ACTIVE object (zero rows when there is none).
      await tx.$executeRaw`
        UPDATE "ShopLogoObject" SET "status" = 'RELEASED', "releasedAt" = now()
        WHERE "shopId" = ${owner.shopId}::uuid AND "status" = 'ACTIVE'`;
      await this.faults.afterReleasePrevious?.();

      // 6.3 Activate the new object; fails if the cleanup job reclaimed it.
      const activated = await tx.$executeRaw`
        UPDATE "ShopLogoObject" SET "status" = 'ACTIVE'
        WHERE "id" = ${objectId}::uuid AND "status" = 'PENDING'`;
      if (activated !== 1) throw new ObjectReclaimedError();

      // 6.4 Reference it, and 6.5 audit the change.
      await tx.shop.update({ where: { id: owner.shopId }, data: { logoUrl } });
      await tx.shopFieldChangeEvent.create({
        data: {
          shopId: owner.shopId,
          field: "logoUrl",
          oldValue: shop.logoUrl,
          newValue: logoUrl,
          actorUserId: owner.userId,
          source: "LOGO_UPLOAD",
        },
      });
    });
    return logoUrl;
  }

  /** Fenced return to `PENDING`. `false`: the attempt is stale and nothing changed. */
  private async returnToPending(uploadId: string, attempt: number, code: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "ShopLogoUpload"
      SET "status" = 'PENDING', "lastErrorCode" = ${code}, "leaseExpiresAt" = NULL, "updatedAt" = now()
      WHERE "id" = ${uploadId}::uuid AND "status" = 'PROCESSING' AND "attempt" = ${attempt}`;
    return updated === 1;
  }

  /** Marks this attempt's own object `RELEASED` (never an `ACTIVE` one). `false`: no row was released. */
  private async releaseObject(objectId: string): Promise<boolean> {
    const released = await this.prisma.$executeRaw`
      UPDATE "ShopLogoObject" SET "status" = 'RELEASED', "releasedAt" = now()
      WHERE "id" = ${objectId}::uuid AND "status" = 'PENDING'`;
    return released === 1;
  }

  /** Compensating delete of this attempt's own, released object; on failure reconciliation retries. */
  private async deleteOwnObject(objectId: string, objectKey: string): Promise<void> {
    try {
      await this.storage.deleteMedia(objectKey);
    } catch (error) {
      this.log(`Logo compensating delete failed: ${describeError(error)}`);
      await this.prisma.$executeRaw`
        UPDATE "ShopLogoObject" SET "deleteAttempts" = "deleteAttempts" + 1, "lastDeleteError" = 'COMPENSATING_DELETE_FAILED'
        WHERE "id" = ${objectId}::uuid AND "status" = 'RELEASED'`;
      return;
    }
    await this.prisma.$executeRaw`
      UPDATE "ShopLogoObject" SET "status" = 'DELETED', "deletedAt" = now()
      WHERE "id" = ${objectId}::uuid AND "status" = 'RELEASED'`;
  }

  /** The authoritative state of an upload, as a response (unwon claim or stale attempt). */
  private async currentState(uploadId: string, shopId: string): Promise<LogoCompleteResponse> {
    const rows = await this.prisma.$queryRaw<
      { status: string; rejectionCode: string | null; objectKey: string | null; pastCompleteBy: boolean; leaseLive: boolean }[]
    >`
      SELECT u."status"::text AS "status", u."rejectionCode", o."objectKey",
             now() > u."completeBy" AS "pastCompleteBy",
             (u."leaseExpiresAt" IS NOT NULL AND u."leaseExpiresAt" >= now()) AS "leaseLive"
      FROM "ShopLogoUpload" u LEFT JOIN "ShopLogoObject" o ON o."id" = u."resultObjectId"
      WHERE u."id" = ${uploadId}::uuid AND u."shopId" = ${shopId}::uuid`;
    const upload = rows[0];
    // Another shop's upload is not disclosed.
    if (upload === undefined) throw uploadNotFound();
    switch (upload.status) {
      case "COMPLETED":
        if (upload.objectKey === null) throw new HttpError(500, API_ERROR_CODES.internalError);
        return { logoUrl: this.publicUrl(upload.objectKey) };
      case "REJECTED":
        throw new HttpError(422, upload.rejectionCode ?? "LOGO_INVALID_IMAGE");
      case "EXPIRED":
        throw new HttpError(410, SHOP_ERROR_CODES.logoUploadExpired);
      case "PROCESSING":
        if (upload.leaseLive) throw inProgress();
        if (upload.pastCompleteBy) throw new HttpError(410, SHOP_ERROR_CODES.logoUploadExpired);
        throw inProgress();
      default:
        if (upload.pastCompleteBy) throw new HttpError(410, SHOP_ERROR_CODES.logoUploadExpired);
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
          UPDATE "ShopLogoUpload" SET "stagingDeletedAt" = now()
          WHERE "id" = ${uploadId}::uuid AND "status" IN ('COMPLETED', 'REJECTED', 'EXPIRED') AND "stagingDeletedAt" IS NULL`;
      } catch {
        // Retried by the cleanup job.
      }
    })();
  }
}
