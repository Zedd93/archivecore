CREATE TABLE "jrwa_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "sourceFileName" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "jrwa_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "jrwa_versions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "jrwa_versions_tenantId_label_key" ON "jrwa_versions"("tenantId", "label");
CREATE UNIQUE INDEX "jrwa_versions_tenantId_validFrom_key" ON "jrwa_versions"("tenantId", "validFrom");
CREATE INDEX "jrwa_versions_tenantId_validFrom_idx" ON "jrwa_versions"("tenantId", "validFrom");

ALTER TABLE "retention_policies" ADD COLUMN "jrwaVersionId" UUID;
CREATE INDEX "retention_policies_jrwaVersionId_idx" ON "retention_policies"("jrwaVersionId");
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_jrwaVersionId_fkey" FOREIGN KEY ("jrwaVersionId") REFERENCES "jrwa_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
