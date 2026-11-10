-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Delivery" (
    "id" UUID NOT NULL,
    "shopOrderId" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "autoCloseAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryStatusEvent" (
    "id" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "fromStatus" "DeliveryStatus",
    "toStatus" "DeliveryStatus" NOT NULL,
    "actorType" "OrderActorType" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(40),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_shopOrderId_key" ON "Delivery"("shopOrderId");

-- CreateIndex
CREATE INDEX "Delivery_status_autoCloseAt_idx" ON "Delivery"("status", "autoCloseAt");

-- CreateIndex
CREATE INDEX "DeliveryStatusEvent_deliveryId_createdAt_idx" ON "DeliveryStatusEvent"("deliveryId", "createdAt");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryStatusEvent" ADD CONSTRAINT "DeliveryStatusEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Database-level guards (spec 11 lifecycle, spec 12 delivery record).
ALTER TABLE "ShopOrder"
  -- Free text only explains a customer's OTHER (S2-4).
  ADD CONSTRAINT "ShopOrder_reason_text_other" CHECK ("reasonText" IS NULL OR COALESCE("reasonCode" = 'OTHER', false)),
  -- Only a cancelled shop order says who cancelled it.
  ADD CONSTRAINT "ShopOrder_cancelled_by_status" CHECK ("cancelledBy" IS NULL OR "status" = 'CANCELLED'),
  -- Internal reasons and notes belong to administrator cancellations only, which always have a reason (D6).
  ADD CONSTRAINT "ShopOrder_internal_reason_admin" CHECK (
    COALESCE("cancelledBy" = 'ADMIN', false) = ("internalReason" IS NOT NULL)
    AND ("internalNote" IS NULL OR COALESCE("cancelledBy" = 'ADMIN', false))
  ),
  -- A final shop order records when it ended; an open one has not ended.
  ADD CONSTRAINT "ShopOrder_closed_when_final" CHECK (("closedAt" IS NULL) = ("status" IN ('PENDING', 'CONFIRMED')));

-- A delivery is closed only as a failure (spec 12).
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_closed_only_failed" CHECK ("closedAt" IS NULL OR "status" = 'FAILED');
