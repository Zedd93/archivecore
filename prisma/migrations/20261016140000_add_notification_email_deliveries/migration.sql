CREATE TABLE "notification_email_deliveries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "notificationId" UUID NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lastError" VARCHAR(255),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "notification_email_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_email_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "notification_email_deliveries_notificationId_key" ON "notification_email_deliveries"("notificationId");
CREATE INDEX "notification_email_deliveries_status_nextAttemptAt_idx" ON "notification_email_deliveries"("status", "nextAttemptAt");
CREATE INDEX "notification_email_deliveries_status_leaseUntil_idx" ON "notification_email_deliveries"("status", "leaseUntil");
