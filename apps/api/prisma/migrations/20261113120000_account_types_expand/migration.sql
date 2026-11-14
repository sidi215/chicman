-- AT-1 account types, expand step (context/account-types-audit.md, sections 9 and 14).
-- Additive only: the current code keeps working. The contract step (phase 4)
-- backfills User.accountType, sets it NOT NULL, and adds the composite keys.
-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BUYER', 'SELLER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AdminAccessAction" AS ENUM ('DEACTIVATED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "accountType" "AccountType",
ADD COLUMN     "adminAccessDeactivatedAt" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "AdminAccessEvent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "action" "AdminAccessAction" NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "operatorNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccessEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationIntent" (
    "supabaseUserId" UUID NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RegistrationIntent_pkey" PRIMARY KEY ("supabaseUserId")
);

-- CreateTable
CREATE TABLE "ShopOwnershipEvent" (
    "id" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "operatorNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopOwnershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAccessEvent_userId_createdAt_idx" ON "AdminAccessEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RegistrationIntent_createdAt_idx" ON "RegistrationIntent"("createdAt");

-- CreateIndex
CREATE INDEX "ShopOwnershipEvent_shopId_createdAt_idx" ON "ShopOwnershipEvent"("shopId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_id_accountType_key" ON "User"("id", "accountType");

-- AddForeignKey
ALTER TABLE "AdminAccessEvent" ADD CONSTRAINT "AdminAccessEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOwnershipEvent" ADD CONSTRAINT "ShopOwnershipEvent_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOwnershipEvent" ADD CONSTRAINT "ShopOwnershipEvent_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOwnershipEvent" ADD CONSTRAINT "ShopOwnershipEvent_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- AT-1 rules Prisma cannot express.

-- Only an administrator account can have its administrative access deactivated (Q7).
ALTER TABLE "User"
  ADD CONSTRAINT "User_admin_deactivation_only_admin" CHECK ("adminAccessDeactivatedAt" IS NULL OR "accountType" = 'ADMIN');

-- Public registration chooses BUYER or SELLER only; ADMIN is provisioned by an operator.
ALTER TABLE "RegistrationIntent"
  ADD CONSTRAINT "RegistrationIntent_registrable_type" CHECK ("accountType" IN ('BUYER', 'SELLER'));

ALTER TABLE "AdminAccessEvent"
  ADD CONSTRAINT "AdminAccessEvent_reason_not_blank" CHECK (btrim("reason") <> '');

ALTER TABLE "ShopOwnershipEvent"
  ADD CONSTRAINT "ShopOwnershipEvent_reason_not_blank" CHECK (btrim("reason") <> ''),
  ADD CONSTRAINT "ShopOwnershipEvent_different_owners" CHECK ("fromUserId" <> "toUserId");

-- The account type is set once (from NULL, by setup, provisioning, or the
-- reviewed backfill) and never changed afterwards, by any path.
CREATE FUNCTION "User_accountType_immutable"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."accountType" IS NOT NULL AND NEW."accountType" IS DISTINCT FROM OLD."accountType" THEN
    RAISE EXCEPTION 'User.accountType cannot be changed once set'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'User_accountType_immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "User_accountType_immutable"
  BEFORE UPDATE OF "accountType" ON "User"
  FOR EACH ROW EXECUTE FUNCTION "User_accountType_immutable"();
