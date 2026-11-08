-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('CLOTHING', 'SHOES', 'FASHION_ACCESSORIES');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductImageUploadStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProductImageStatus" AS ENUM ('PENDING', 'ACTIVE', 'RELEASED', 'DELETED');

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "brand" VARCHAR(100),
    "price" DECIMAL(12,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMPTZ(3),
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductVariant" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "size" VARCHAR(30),
    "color" VARCHAR(50),
    "stock" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImageUpload" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "stagingKey" VARCHAR(512) NOT NULL,
    "declaredContentType" VARCHAR(32) NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "status" "ProductImageUploadStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "completeBy" TIMESTAMPTZ(3) NOT NULL,
    "rejectionCode" VARCHAR(64),
    "lastErrorCode" VARCHAR(64),
    "resultImageId" UUID,
    "completedAt" TIMESTAMPTZ(3),
    "stagingDeletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductImageUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "uploadId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "objectKey" VARCHAR(512) NOT NULL,
    "contentType" VARCHAR(32) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductImageStatus" NOT NULL DEFAULT 'PENDING',
    "deleteAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDeleteError" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_shopId_createdAt_idx" ON "Product"("shopId", "createdAt");

-- CreateIndex
CREATE INDEX "Product_status_createdAt_idx" ON "Product"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductVariant_productId_idx" ON "ProductVariant"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImageUpload_stagingKey_key" ON "ProductImageUpload"("stagingKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImageUpload_resultImageId_key" ON "ProductImageUpload"("resultImageId");

-- CreateIndex
CREATE INDEX "ProductImageUpload_productId_createdAt_idx" ON "ProductImageUpload"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductImageUpload_status_completeBy_idx" ON "ProductImageUpload"("status", "completeBy");

-- CreateIndex
CREATE UNIQUE INDEX "ProductImage_objectKey_key" ON "ProductImage"("objectKey");

-- CreateIndex
CREATE INDEX "ProductImage_productId_status_idx" ON "ProductImage"("productId", "status");

-- CreateIndex
CREATE INDEX "ProductImage_status_createdAt_idx" ON "ProductImage"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImageUpload" ADD CONSTRAINT "ProductImageUpload_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImageUpload" ADD CONSTRAINT "ProductImageUpload_resultImageId_fkey" FOREIGN KEY ("resultImageId") REFERENCES "ProductImage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "ProductImageUpload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Guards Prisma cannot express.

-- Prices are positive, stock is never negative, and text is non-empty after
-- trimming. The status timestamps stay consistent with the status.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_price_positive" CHECK ("price" > 0),
  ADD CONSTRAINT "Product_stock_range" CHECK ("stock" >= 0 AND "stock" <= 1000000),
  ADD CONSTRAINT "Product_text_not_blank" CHECK (
    length(btrim("name")) > 0 AND length(btrim("description")) > 0
    AND ("brand" IS NULL OR length(btrim("brand")) > 0)
  ),
  ADD CONSTRAINT "Product_published_has_time" CHECK ("status" <> 'PUBLISHED' OR "publishedAt" IS NOT NULL),
  ADD CONSTRAINT "Product_archived_has_time" CHECK (("status" = 'ARCHIVED') = ("archivedAt" IS NOT NULL));

-- A variant has a size, a color, or both, and is unique within its product,
-- ignoring case.
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_stock_range" CHECK ("stock" >= 0 AND "stock" <= 1000000),
  ADD CONSTRAINT "ProductVariant_has_attribute" CHECK ("size" IS NOT NULL OR "color" IS NOT NULL);
CREATE UNIQUE INDEX "ProductVariant_unique_attributes" ON "ProductVariant"(
  "productId", lower(coalesce("size", '')), lower(coalesce("color", ''))
);

-- A completed upload references its result image.
ALTER TABLE "ProductImageUpload"
  ADD CONSTRAINT "ProductImageUpload_completed_has_result" CHECK (("status" = 'COMPLETED') = ("resultImageId" IS NOT NULL)),
  ADD CONSTRAINT "ProductImageUpload_declared_size" CHECK ("declaredSize" > 0 AND "declaredSize" <= 2097152);

-- Only verified images are recorded: JPEG, PNG, or WebP (never SVG), within
-- 2 MB and 1024 × 1024.
ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_content_type" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "ProductImage_size" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 2097152),
  ADD CONSTRAINT "ProductImage_dimensions" CHECK ("width" BETWEEN 1 AND 1024 AND "height" BETWEEN 1 AND 1024),
  ADD CONSTRAINT "ProductImage_position" CHECK ("position" >= 0);
