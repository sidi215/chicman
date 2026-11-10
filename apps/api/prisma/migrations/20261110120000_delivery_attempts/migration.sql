-- Delivery attempts (spec 12). Additive: the Delivery and DeliveryStatusEvent
-- tables already exist (migration order_lifecycle).

-- CreateEnum
CREATE TYPE "DeliveryAttemptOutcome" AS ENUM ('DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryFailureReason" AS ENUM ('CUSTOMER_UNREACHABLE', 'CUSTOMER_ABSENT', 'CUSTOMER_REFUSED', 'ADDRESS_NOT_FOUND', 'CUSTOMER_COULD_NOT_PAY', 'OTHER');

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "dispatchedAt" TIMESTAMPTZ(3) NOT NULL,
    "dispatchedByUserId" UUID NOT NULL,
    "outcome" "DeliveryAttemptOutcome",
    "failureReason" "DeliveryFailureReason",
    "outcomeAt" TIMESTAMPTZ(3),
    "outcomeByUserId" UUID,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_deliveryId_number_key" ON "DeliveryAttempt"("deliveryId", "number");

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards (spec 12).
-- At most one open attempt per delivery.
CREATE UNIQUE INDEX "DeliveryAttempt_one_open_per_delivery" ON "DeliveryAttempt"("deliveryId") WHERE "outcome" IS NULL;
-- Attempts are numbered from 1.
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_number_positive" CHECK ("number" >= 1);
-- A failure reason exactly when the attempt failed.
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_reason_exactly_when_failed"
  CHECK ((COALESCE("outcome"::text, '') = 'FAILED') = ("failureReason" IS NOT NULL));
-- The outcome's time and actor exactly when there is an outcome.
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_outcome_recorded"
  CHECK (("outcome" IS NULL) = ("outcomeAt" IS NULL) AND ("outcome" IS NULL) = ("outcomeByUserId" IS NULL));
-- A closed failure is final; an open failure has a deadline; nothing else has one.
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_auto_close_only_failed" CHECK ("autoCloseAt" IS NULL OR "status" = 'FAILED');
