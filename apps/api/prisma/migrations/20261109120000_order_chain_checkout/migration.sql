-- CreateEnum
CREATE TYPE "NotificationResourceType" AS ENUM ('SHOP', 'SHOP_ORDER');

-- CreateEnum
CREATE TYPE "ShopOrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'DELIVERED', 'FAILED_DELIVERY');

-- CreateEnum
CREATE TYPE "OrderActorType" AS ENUM ('CUSTOMER', 'SELLER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('TAKEN', 'RETURNED');

-- CreateEnum
CREATE TYPE "StockMovementSkipReason" AS ENUM ('VARIANT_REMOVED', 'VARIANT_STRUCTURE_CHANGED', 'ABOVE_MAXIMUM');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COLLECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentEventType" AS ENUM ('CREATED', 'COLLECTED', 'FAILED', 'CANCELLED', 'ADMIN_NOTE');

-- AlterEnum
ALTER TYPE "ShopField" ADD VALUE 'deliveryFee';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "eventKey" VARCHAR(200),
ADD COLUMN     "resourceId" UUID,
ADD COLUMN     "resourceType" "NotificationResourceType";

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "deliveryFee" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(20) NOT NULL,
    "userId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "productsSubtotal" DECIMAL(12,2) NOT NULL,
    "deliveryFeeTotal" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "shopId" UUID NOT NULL,
    "shopName" VARCHAR(100) NOT NULL,
    "shopContactPhone" VARCHAR(16) NOT NULL,
    "shopWhatsappPhone" VARCHAR(16),
    "status" "ShopOrderStatus" NOT NULL DEFAULT 'PENDING',
    "respondBy" TIMESTAMPTZ(3) NOT NULL,
    "remindAt" TIMESTAMPTZ(3) NOT NULL,
    "productsSubtotal" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "recipientName" VARCHAR(100) NOT NULL,
    "deliveryPhone" VARCHAR(16) NOT NULL,
    "addressLabel" VARCHAR(50),
    "city" VARCHAR(100) NOT NULL,
    "district" VARCHAR(100) NOT NULL,
    "landmark" VARCHAR(300) NOT NULL,
    "latitude" DECIMAL(9,6) NOT NULL,
    "longitude" DECIMAL(9,6) NOT NULL,
    "locationSource" "AddressLocationSource" NOT NULL,
    "accuracyMeters" INTEGER,
    "decidedAt" TIMESTAMPTZ(3),
    "reasonCode" VARCHAR(40),
    "reasonText" VARCHAR(200),
    "cancelledBy" "OrderActorType",
    "internalReason" VARCHAR(500),
    "internalNote" VARCHAR(1000),
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShopOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "shopOrderId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "productName" VARCHAR(150) NOT NULL,
    "size" VARCHAR(30),
    "color" VARCHAR(50),
    "imageObjectKey" VARCHAR(512),
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopOrderStatusEvent" (
    "id" UUID NOT NULL,
    "shopOrderId" UUID NOT NULL,
    "fromStatus" "ShopOrderStatus",
    "toStatus" "ShopOrderStatus" NOT NULL,
    "actorType" "OrderActorType" NOT NULL,
    "actorUserId" UUID,
    "reasonCode" VARCHAR(40),
    "reasonText" VARCHAR(200),
    "internalReason" VARCHAR(500),
    "internalNote" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopOrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "variantId" UUID,
    "quantity" INTEGER NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "applied" BOOLEAN NOT NULL,
    "skipReason" "StockMovementSkipReason",
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "shopOrderId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    "amountDue" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "collectedAmount" DECIMAL(12,2),
    "collectedAt" TIMESTAMPTZ(3),
    "collectedByUserId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "type" "PaymentEventType" NOT NULL,
    "amount" DECIMAL(12,2),
    "actorType" "OrderActorType" NOT NULL,
    "actorUserId" UUID,
    "reason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_reference_key" ON "Order"("reference");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_userId_idempotencyKey_key" ON "Order"("userId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ShopOrder_shopId_status_createdAt_idx" ON "ShopOrder"("shopId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ShopOrder_status_respondBy_idx" ON "ShopOrder"("status", "respondBy");

-- CreateIndex
CREATE INDEX "ShopOrder_status_remindAt_idx" ON "ShopOrder"("status", "remindAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShopOrder_orderId_shopId_key" ON "ShopOrder"("orderId", "shopId");

-- CreateIndex
CREATE INDEX "OrderItem_shopOrderId_idx" ON "OrderItem"("shopOrderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderItem_imageObjectKey_idx" ON "OrderItem"("imageObjectKey");

-- CreateIndex
CREATE INDEX "ShopOrderStatusEvent_shopOrderId_createdAt_idx" ON "ShopOrderStatusEvent"("shopOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockMovement_orderItemId_type_key" ON "StockMovement"("orderItemId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_shopOrderId_key" ON "Payment"("shopOrderId");

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentId_createdAt_idx" ON "PaymentEvent"("paymentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_eventKey_key" ON "Notification"("eventKey");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrder" ADD CONSTRAINT "ShopOrder_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopOrderStatusEvent" ADD CONSTRAINT "ShopOrderStatusEvent_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shopOrderId_fkey" FOREIGN KEY ("shopOrderId") REFERENCES "ShopOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Database-level guards (order chain: specs 06 D2, 10, 11, 13).
-- Delivery fee: free delivery is 0; never negative.
ALTER TABLE "Shop" ADD CONSTRAINT "Shop_deliveryFee_non_negative" CHECK ("deliveryFee" IS NULL OR "deliveryFee" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_non_negative" CHECK ("productsSubtotal" >= 0 AND "deliveryFeeTotal" >= 0),
  ADD CONSTRAINT "Order_total_sum" CHECK ("total" = "productsSubtotal" + "deliveryFeeTotal");

ALTER TABLE "ShopOrder"
  ADD CONSTRAINT "ShopOrder_amounts_non_negative" CHECK ("productsSubtotal" >= 0 AND "deliveryFee" >= 0),
  ADD CONSTRAINT "ShopOrder_total_sum" CHECK ("total" = "productsSubtotal" + "deliveryFee"),
  ADD CONSTRAINT "ShopOrder_deadlines" CHECK ("remindAt" <= "respondBy"),
  ADD CONSTRAINT "ShopOrder_recipient_not_blank" CHECK (length(btrim("recipientName")) > 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_positive" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "OrderItem_price_positive" CHECK ("unitPrice" > 0),
  ADD CONSTRAINT "OrderItem_line_total" CHECK ("lineTotal" = "unitPrice" * "quantity");

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_quantity_positive" CHECK ("quantity" >= 1),
  -- A skipped movement says why; an applied one has no skip reason.
  ADD CONSTRAINT "StockMovement_skip_reason" CHECK ("applied" = ("skipReason" IS NULL));

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_due_non_negative" CHECK ("amountDue" >= 0),
  -- The collected amount equals the amount due exactly when collected (spec 13).
  ADD CONSTRAINT "Payment_collection_consistent" CHECK (
    ("status" = 'COLLECTED') = COALESCE(
      "collectedAmount" = "amountDue" AND "collectedAt" IS NOT NULL AND "collectedByUserId" IS NOT NULL, false)
  ),
  ADD CONSTRAINT "Payment_no_collection_unless_collected" CHECK (
    "status" = 'COLLECTED' OR ("collectedAmount" IS NULL AND "collectedAt" IS NULL AND "collectedByUserId" IS NULL)
  );
