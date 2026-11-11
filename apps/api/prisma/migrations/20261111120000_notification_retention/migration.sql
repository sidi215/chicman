-- Spec 15, O6.3: notification retention (365 days) without weakening event idempotency.

-- CreateTable
CREATE TABLE "NotificationEvent" (
    "eventKey" VARCHAR(200) NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("eventKey")
);

-- Backfill: every key already recorded stays recorded once its notification is deleted.
INSERT INTO "NotificationEvent" ("eventKey", "recordedAt")
SELECT "eventKey", "createdAt" FROM "Notification" WHERE "eventKey" IS NOT NULL
ON CONFLICT ("eventKey") DO NOTHING;

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");
