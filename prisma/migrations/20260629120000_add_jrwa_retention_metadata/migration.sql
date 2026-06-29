ALTER TABLE "retention_policies"
  ALTER COLUMN "retentionYears" DROP NOT NULL,
  ADD COLUMN "jrwaCode" VARCHAR(20),
  ADD COLUMN "archivalCategory" VARCHAR(20),
  ADD COLUMN "isPermanent" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceFileName" VARCHAR(500);

CREATE INDEX "retention_policies_tenantId_jrwaCode_idx"
  ON "retention_policies"("tenantId", "jrwaCode");
