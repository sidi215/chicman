-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('fr', 'ar');

-- CreateEnum
CREATE TYPE "CustomerPhoneChangeType" AS ENUM ('ACCOUNT_SETUP', 'CUSTOMER_UPDATE');

-- CreateTable
CREATE TABLE "CustomerProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fullName" VARCHAR(100),
    "preferredLocale" "Locale" NOT NULL DEFAULT 'fr',
    "phone" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CustomerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPhoneChange" (
    "id" UUID NOT NULL,
    "customerProfileId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "changeType" "CustomerPhoneChangeType" NOT NULL,
    "previousPhone" VARCHAR(16),
    "newPhone" VARCHAR(16) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPhoneChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerProfile_userId_key" ON "CustomerProfile"("userId");

-- CreateIndex
CREATE INDEX "CustomerPhoneChange_customerProfileId_createdAt_idx" ON "CustomerPhoneChange"("customerProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerPhoneChange_createdAt_idx" ON "CustomerPhoneChange"("createdAt");

-- AddForeignKey
ALTER TABLE "CustomerProfile" ADD CONSTRAINT "CustomerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPhoneChange" ADD CONSTRAINT "CustomerPhoneChange_customerProfileId_fkey" FOREIGN KEY ("customerProfileId") REFERENCES "CustomerProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPhoneChange" ADD CONSTRAINT "CustomerPhoneChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards (feature 04). Phones are stored in E.164.
ALTER TABLE "CustomerProfile"
  ADD CONSTRAINT "CustomerProfile_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

ALTER TABLE "CustomerPhoneChange"
  ADD CONSTRAINT "CustomerPhoneChange_newPhone_e164" CHECK ("newPhone" ~ '^\+[1-9][0-9]{7,14}$'),
  ADD CONSTRAINT "CustomerPhoneChange_previousPhone_e164" CHECK ("previousPhone" IS NULL OR "previousPhone" ~ '^\+[1-9][0-9]{7,14}$'),
  -- Only the account-setup entry has no previous value.
  ADD CONSTRAINT "CustomerPhoneChange_previous_by_type" CHECK (
    ("changeType" = 'ACCOUNT_SETUP' AND "previousPhone" IS NULL)
    OR ("changeType" = 'CUSTOMER_UPDATE' AND "previousPhone" IS NOT NULL)
  );
