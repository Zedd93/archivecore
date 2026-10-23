ALTER TABLE "transfer_lists" ADD COLUMN "reviewedScanFingerprint" VARCHAR(64);

CREATE UNIQUE INDEX "transfer_lists_tenantId_reviewedScanFingerprint_key"
ON "transfer_lists"("tenantId", "reviewedScanFingerprint");
