ALTER TABLE "boxes" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "boxes_tenantId_deletedAt_idx" ON "boxes"("tenantId", "deletedAt");
