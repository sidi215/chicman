-- Spec 19: product moderation. An administrator-owned moderation state on each
-- product, buyer reports grouped into cases, and an append-only history.
--
-- Nothing here is ever deleted (every foreign key RESTRICT). Reports and events
-- are immutable (triggers below). `REMOVED` is final (trigger below). The test
-- reset bypasses the immutability triggers with `session_replication_role`,
-- which only a superuser may set; production roles must not be superusers.

-- CreateEnum
CREATE TYPE "ProductModerationStatus" AS ENUM ('CLEAR', 'RESTRICTED', 'IN_REVIEW', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProductModerationReason" AS ENUM ('COUNTERFEIT', 'PROHIBITED_ITEM', 'NOT_NEW', 'NOT_FASHION', 'MISLEADING_INFORMATION', 'INAPPROPRIATE_IMAGES', 'WRONG_CATEGORY', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductReportReason" AS ENUM ('COUNTERFEIT', 'PROHIBITED_ITEM', 'NOT_NEW', 'NOT_FASHION', 'MISLEADING_INFORMATION', 'INAPPROPRIATE_CONTENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductModerationCaseStatus" AS ENUM ('OPEN', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "ProductModerationCaseOutcome" AS ENUM ('DISMISSED', 'RESTORED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ProductModerationCaseSource" AS ENUM ('REPORT', 'ADMIN_INSPECTION');

-- CreateEnum
CREATE TYPE "ProductModerationAction" AS ENUM ('REPORTED', 'DISMISSED', 'RESTRICTED', 'RESUBMITTED', 'CORRECTION_REQUESTED', 'RESTORED', 'REMOVED');

-- CreateEnum
CREATE TYPE "ModerationActorType" AS ENUM ('BUYER', 'SELLER', 'ADMIN');

-- AlterEnum
ALTER TYPE "NotificationResourceType" ADD VALUE 'PRODUCT';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "moderationStatus" "ProductModerationStatus" NOT NULL DEFAULT 'CLEAR',
ADD COLUMN     "moderationUpdatedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "ProductModerationCase" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "status" "ProductModerationCaseStatus" NOT NULL,
    "outcome" "ProductModerationCaseOutcome",
    "source" "ProductModerationCaseSource" NOT NULL,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedByUserId" UUID,
    "closedAt" TIMESTAMPTZ(3),
    "closedByUserId" UUID,
    "reportCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductModerationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductReport" (
    "id" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "reporterUserId" UUID NOT NULL,
    "reasonCode" "ProductReportReason" NOT NULL,
    "details" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductModerationEvent" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "caseId" UUID NOT NULL,
    "action" "ProductModerationAction" NOT NULL,
    "fromStatus" "ProductModerationStatus",
    "toStatus" "ProductModerationStatus",
    "actorType" "ModerationActorType" NOT NULL,
    "actorUserId" UUID NOT NULL,
    "sellerReasonCode" "ProductModerationReason",
    "sellerMessage" VARCHAR(1000),
    "sellerNote" VARCHAR(500),
    "internalReason" VARCHAR(500),
    "internalNote" VARCHAR(1000),
    "contentSnapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductModerationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductModerationCase_status_openedAt_idx" ON "ProductModerationCase"("status", "openedAt");

-- CreateIndex
CREATE INDEX "ProductModerationCase_productId_openedAt_idx" ON "ProductModerationCase"("productId", "openedAt");

-- CreateIndex
CREATE INDEX "ProductModerationCase_shopId_openedAt_idx" ON "ProductModerationCase"("shopId", "openedAt");

-- CreateIndex
CREATE INDEX "ProductReport_productId_createdAt_idx" ON "ProductReport"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductReport_reporterUserId_createdAt_idx" ON "ProductReport"("reporterUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReport_caseId_reporterUserId_key" ON "ProductReport"("caseId", "reporterUserId");

-- CreateIndex
CREATE INDEX "ProductModerationEvent_productId_createdAt_idx" ON "ProductModerationEvent"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductModerationEvent_caseId_createdAt_idx" ON "ProductModerationEvent"("caseId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_moderationStatus_moderationUpdatedAt_idx" ON "Product"("moderationStatus", "moderationUpdatedAt");

-- AddForeignKey
ALTER TABLE "ProductModerationCase" ADD CONSTRAINT "ProductModerationCase_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModerationCase" ADD CONSTRAINT "ProductModerationCase_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModerationCase" ADD CONSTRAINT "ProductModerationCase_openedByUserId_fkey" FOREIGN KEY ("openedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModerationCase" ADD CONSTRAINT "ProductModerationCase_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ProductModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReport" ADD CONSTRAINT "ProductReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModerationEvent" ADD CONSTRAINT "ProductModerationEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModerationEvent" ADD CONSTRAINT "ProductModerationEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ProductModerationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductModerationEvent" ADD CONSTRAINT "ProductModerationEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- At most one non-closed case per product; it also settles two reports racing
-- to open a case (section 8.3).
CREATE UNIQUE INDEX "ProductModerationCase_productId_open_key"
  ON "ProductModerationCase"("productId") WHERE "status" <> 'CLOSED';

-- Closed ⇔ outcome and closing time set.
ALTER TABLE "ProductModerationCase"
  ADD CONSTRAINT "ProductModerationCase_closed_check"
    CHECK (("status" = 'CLOSED') = ("outcome" IS NOT NULL) AND ("status" = 'CLOSED') = ("closedAt" IS NOT NULL)),
  ADD CONSTRAINT "ProductModerationCase_reportCount_check" CHECK ("reportCount" >= 0);

-- Only a Buyer reports (PD-1), like the AT-1 owner triggers.
CREATE FUNCTION "ProductReport_reporter_is_buyer"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "AT1_require_account_type"(NEW."reporterUserId", 'BUYER', 'ProductReport_reporter_is_buyer');
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ProductReport_reporter_is_buyer" BEFORE INSERT ON "ProductReport"
  FOR EACH ROW EXECUTE FUNCTION "ProductReport_reporter_is_buyer"();

-- Reports and events are immutable: no UPDATE or DELETE (section 9).
CREATE FUNCTION "Moderation_immutable_row"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'spec 19: % rows are immutable', TG_TABLE_NAME
    USING ERRCODE = 'check_violation', CONSTRAINT = TG_TABLE_NAME || '_immutable';
END;
$$;
CREATE TRIGGER "ProductReport_immutable" BEFORE UPDATE OR DELETE ON "ProductReport"
  FOR EACH ROW EXECUTE FUNCTION "Moderation_immutable_row"();
CREATE TRIGGER "ProductModerationEvent_immutable" BEFORE UPDATE OR DELETE ON "ProductModerationEvent"
  FOR EACH ROW EXECUTE FUNCTION "Moderation_immutable_row"();

-- The reasons each action requires (section 3.2) and who performs it.
ALTER TABLE "ProductModerationEvent"
  ADD CONSTRAINT "ProductModerationEvent_actor_check" CHECK (
    CASE "action"
      WHEN 'REPORTED' THEN "actorType" = 'BUYER'
      WHEN 'RESUBMITTED' THEN "actorType" = 'SELLER'
      ELSE "actorType" = 'ADMIN'
    END),
  ADD CONSTRAINT "ProductModerationEvent_reasons_check" CHECK (
    CASE
      WHEN "action" IN ('RESTRICTED', 'CORRECTION_REQUESTED', 'REMOVED') THEN
        "sellerReasonCode" IS NOT NULL AND "sellerMessage" IS NOT NULL AND "internalReason" IS NOT NULL
      WHEN "action" = 'RESTORED' THEN
        "sellerReasonCode" IS NULL AND "internalReason" IS NOT NULL
      WHEN "action" = 'DISMISSED' THEN
        "sellerReasonCode" IS NULL AND "sellerMessage" IS NULL AND "internalReason" IS NOT NULL
      ELSE
        "sellerReasonCode" IS NULL AND "sellerMessage" IS NULL AND "internalReason" IS NULL AND "internalNote" IS NULL
    END),
  ADD CONSTRAINT "ProductModerationEvent_sellerNote_check" CHECK ("sellerNote" IS NULL OR "action" = 'RESUBMITTED'),
  ADD CONSTRAINT "ProductModerationEvent_lengths_check" CHECK (
    ("sellerMessage" IS NULL OR char_length("sellerMessage") BETWEEN 10 AND 1000)
    AND ("internalReason" IS NULL OR char_length("internalReason") BETWEEN 10 AND 500)),
  ADD CONSTRAINT "ProductModerationEvent_snapshot_check" CHECK (jsonb_typeof("contentSnapshot") = 'object');

-- `REMOVED` has no way out (PD-9).
CREATE FUNCTION "Product_moderation_removed_final"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."moderationStatus" = 'REMOVED' AND NEW."moderationStatus" IS DISTINCT FROM 'REMOVED' THEN
    RAISE EXCEPTION 'spec 19: a removed product stays removed'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'Product_moderation_removed_final';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Product_moderation_removed_final" BEFORE UPDATE OF "moderationStatus" ON "Product"
  FOR EACH ROW EXECUTE FUNCTION "Product_moderation_removed_final"();

-- Spec 18's search trigger also watches the moderation state, so every
-- transition queues the product (spec 19, section 7).
DROP TRIGGER "Product_search_index" ON "Product";
CREATE TRIGGER "Product_search_index"
  AFTER INSERT OR DELETE OR UPDATE OF "shopId", "name", "description", "category", "brand", "price", "stock", "status", "publishedAt", "moderationStatus"
  ON "Product" FOR EACH ROW EXECUTE FUNCTION "Product_search_index"();
