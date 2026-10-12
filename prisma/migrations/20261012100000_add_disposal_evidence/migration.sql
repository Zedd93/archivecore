CREATE TABLE "disposal_evidence" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "fileName" VARCHAR(500) NOT NULL,
  "storageKey" VARCHAR(1000) NOT NULL,
  "mimeType" VARCHAR(30) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "checksumSha256" VARCHAR(64) NOT NULL,
  "uploadedById" UUID NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "disposal_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "disposal_evidence_tenantId_batchId_checksumSha256_key" ON "disposal_evidence"("tenantId", "batchId", "checksumSha256");
ALTER TABLE "disposal_evidence" ADD CONSTRAINT "disposal_evidence_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disposal_evidence" ADD CONSTRAINT "disposal_evidence_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
