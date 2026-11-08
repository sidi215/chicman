-- CreateEnum
CREATE TYPE "AddressLocationSource" AS ENUM ('GPS', 'MANUAL');

-- CreateTable
CREATE TABLE "CustomerAddress" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" VARCHAR(50),
    "city" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "landmark" VARCHAR(300) NOT NULL,
    "deliveryPhone" VARCHAR(16),
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "locationSource" "AddressLocationSource" NOT NULL,
    "accuracyMeters" INTEGER,
    "locationConfirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerAddress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerAddress_userId_updatedAt_idx" ON "CustomerAddress"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "CustomerAddress" ADD CONSTRAINT "CustomerAddress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards (feature 05).
-- At most one default address per customer.
CREATE UNIQUE INDEX "CustomerAddress_one_default_per_user" ON "CustomerAddress"("userId") WHERE "isDefault";

ALTER TABLE "CustomerAddress"
  ADD CONSTRAINT "CustomerAddress_deliveryPhone_e164" CHECK ("deliveryPhone" IS NULL OR "deliveryPhone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "CustomerAddress_text_not_blank" CHECK (
    length(btrim("city")) > 0 AND length(btrim("district")) > 0 AND length(btrim("landmark")) > 0
    AND ("label" IS NULL OR length(btrim("label")) > 0)
  ),
  -- Service area: Mauritania's bounding box (spec 05).
  ADD CONSTRAINT "CustomerAddress_service_area" CHECK (
    "latitude" BETWEEN 14.6 AND 27.4 AND "longitude" BETWEEN -17.2 AND -4.7
  ),
  ADD CONSTRAINT "CustomerAddress_accuracy" CHECK ("accuracyMeters" IS NULL OR "accuracyMeters" >= 0);
