CREATE TYPE "BillingPeriodStatus" AS ENUM ('open', 'closed');

ALTER TABLE "locations"
  ADD COLUMN "isBillableStorage" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "billing_periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "periodStart" DATE NOT NULL,
  "status" "BillingPeriodStatus" NOT NULL DEFAULT 'open',
  "generatedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "closedById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_periods_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_periods_tenantId_periodStart_key"
  ON "billing_periods"("tenantId", "periodStart");
CREATE INDEX "billing_periods_tenantId_status_idx"
  ON "billing_periods"("tenantId", "status");

ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
