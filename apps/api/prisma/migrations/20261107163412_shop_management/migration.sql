-- Feature 06 (Shop Management). Adds the application fields to Shop
-- (required: the table had no rows when this was written), the shop audit
-- records, change requests, logo upload state, and notification records.

-- CreateEnum
CREATE TYPE "ShopDecisionType" AS ENUM ('APPLICATION_APPROVED', 'APPLICATION_REJECTED', 'SUSPENDED', 'REINSTATED');

-- CreateEnum
CREATE TYPE "ShopChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ShopField" AS ENUM ('shopName', 'description', 'contactPhone', 'city', 'address', 'whatsappPhone', 'logoUrl');

-- CreateEnum
CREATE TYPE "ShopFieldChangeSource" AS ENUM ('OWNER_UPDATE', 'CHANGE_REQUEST_APPROVED', 'LOGO_UPLOAD');

-- CreateEnum
CREATE TYPE "ShopLogoUploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ShopLogoObjectStatus" AS ENUM ('PENDING', 'ACTIVE', 'RELEASED', 'DELETED');

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "address" VARCHAR(300) NOT NULL,
ADD COLUMN     "city" VARCHAR(100) NOT NULL,
ADD COLUMN     "contactPhone" VARCHAR(16) NOT NULL,
ADD COLUMN     "description" VARCHAR(2000) NOT NULL,
ADD COLUMN     "logoUrl" VARCHAR(2048),
ADD COLUMN     "shopName" VARCHAR(100) NOT NULL,
ADD COLUMN     "whatsappPhone" VARCHAR(16);

-- CreateTable
CREATE TABLE "ShopStatusEvent" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "fromStatus" "ShopStatus",
    "toStatus" "ShopStatus" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "decisionType" "ShopDecisionType",
    "internalReason" VARCHAR(500),
    "applicantReason" VARCHAR(500),
    "internalNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopChangeRequest" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "proposedShopName" VARCHAR(100),
    "proposedCity" VARCHAR(100),
    "status" "ShopChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByUserId" UUID NOT NULL,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedByUserId" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "internalReason" VARCHAR(500),
    "internalNote" VARCHAR(1000),

    CONSTRAINT "ShopChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopFieldChangeEvent" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "field" "ShopField" NOT NULL,
    "oldValue" VARCHAR(2048),
    "newValue" VARCHAR(2048),
    "actorUserId" UUID NOT NULL,
    "source" "ShopFieldChangeSource" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopFieldChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopLogoUpload" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "stagingKey" VARCHAR(512) NOT NULL,
    "declaredContentType" VARCHAR(32) NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "status" "ShopLogoUploadStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completeBy" TIMESTAMPTZ(3) NOT NULL,
    "rejectionCode" VARCHAR(64),
    "lastErrorCode" VARCHAR(64),
    "resultObjectId" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "stagingDeletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopLogoUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopLogoObject" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "status" "ShopLogoObjectStatus" NOT NULL DEFAULT 'PENDING',
    "deleteAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDeleteError" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ShopLogoObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShopStatusEvent_shopId_createdAt_idx" ON "ShopStatusEvent"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopChangeRequest_shopId_submittedAt_idx" ON "ShopChangeRequest"("shopId", "submittedAt");

-- CreateIndex
CREATE INDEX "ShopFieldChangeEvent_shopId_createdAt_idx" ON "ShopFieldChangeEvent"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopLogoUpload_stagingKey_key" ON "ShopLogoUpload"("stagingKey");

-- CreateIndex
CREATE UNIQUE INDEX "ShopLogoUpload_resultObjectId_key" ON "ShopLogoUpload"("resultObjectId");

-- CreateIndex
CREATE INDEX "ShopLogoUpload_shopId_createdAt_idx" ON "ShopLogoUpload"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "ShopLogoUpload_status_completeBy_idx" ON "ShopLogoUpload"("status", "completeBy");

-- CreateIndex
CREATE UNIQUE INDEX "ShopLogoObject_objectKey_key" ON "ShopLogoObject"("objectKey");

-- CreateIndex
CREATE INDEX "ShopLogoObject_status_createdAt_idx" ON "ShopLogoObject"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_deliveredAt_createdAt_idx" ON "Notification"("deliveredAt", "createdAt");

-- AddForeignKey
ALTER TABLE "ShopStatusEvent" ADD CONSTRAINT "ShopStatusEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopStatusEvent" ADD CONSTRAINT "ShopStatusEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopChangeRequest" ADD CONSTRAINT "ShopChangeRequest_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopChangeRequest" ADD CONSTRAINT "ShopChangeRequest_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopChangeRequest" ADD CONSTRAINT "ShopChangeRequest_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFieldChangeEvent" ADD CONSTRAINT "ShopFieldChangeEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopFieldChangeEvent" ADD CONSTRAINT "ShopFieldChangeEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopLogoUpload" ADD CONSTRAINT "ShopLogoUpload_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopLogoUpload" ADD CONSTRAINT "ShopLogoUpload_resultObjectId_fkey" FOREIGN KEY ("resultObjectId") REFERENCES "ShopLogoObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopLogoObject" ADD CONSTRAINT "ShopLogoObject_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopLogoObject" ADD CONSTRAINT "ShopLogoObject_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ShopLogoUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Database-level guards (feature 06).

-- At most one open change request per shop, and one ACTIVE logo per shop.
-- Prisma has no partial unique indexes.
CREATE UNIQUE INDEX "ShopChangeRequest_open_per_shop" ON "ShopChangeRequest"("shopId") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "ShopLogoObject_active_per_shop" ON "ShopLogoObject"("shopId") WHERE "status" = 'ACTIVE';

-- Phones are stored in E.164; text fields are non-empty after trimming.
ALTER TABLE "Shop"
  ADD CONSTRAINT "Shop_contactPhone_e164" CHECK ("contactPhone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "Shop_whatsappPhone_e164" CHECK ("whatsappPhone" IS NULL OR "whatsappPhone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "Shop_text_not_blank" CHECK (
    length(btrim("shopName")) > 0 AND length(btrim("description")) > 0
    AND length(btrim("city")) > 0 AND length(btrim("address")) > 0
  );

-- Owner actions carry no decision and no reason. An application rejection
-- carries exactly applicantReason; every other decision exactly internalReason.
ALTER TABLE "ShopStatusEvent"
  ADD CONSTRAINT "ShopStatusEvent_reasons_by_decision" CHECK (
    ("decisionType" IS NULL AND "internalReason" IS NULL AND "applicantReason" IS NULL AND "internalNote" IS NULL)
    OR ("decisionType" = 'APPLICATION_REJECTED' AND "applicantReason" IS NOT NULL AND "internalReason" IS NULL)
    OR ("decisionType" IN ('APPLICATION_APPROVED', 'SUSPENDED', 'REINSTATED') AND "internalReason" IS NOT NULL AND "applicantReason" IS NULL)
  );

-- At least one proposed value; a decided request records its decider,
-- time, and internal reason; an open one has none.
ALTER TABLE "ShopChangeRequest"
  ADD CONSTRAINT "ShopChangeRequest_has_proposal" CHECK ("proposedShopName" IS NOT NULL OR "proposedCity" IS NOT NULL),
  ADD CONSTRAINT "ShopChangeRequest_decision_fields" CHECK (
    ("status" = 'PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL AND "internalReason" IS NULL AND "internalNote" IS NULL)
    OR ("status" <> 'PENDING' AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "internalReason" IS NOT NULL)
  );

-- A completed upload references its result object.
ALTER TABLE "ShopLogoUpload"
  ADD CONSTRAINT "ShopLogoUpload_completed_has_result" CHECK (("status" = 'COMPLETED') = ("resultObjectId" IS NOT NULL)),
  ADD CONSTRAINT "ShopLogoUpload_declared_size" CHECK ("declaredSize" > 0 AND "declaredSize" <= 2097152);
