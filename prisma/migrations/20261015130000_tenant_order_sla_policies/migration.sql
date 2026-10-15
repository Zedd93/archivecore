CREATE TABLE "tenant_sla_policies" (
  "tenantId" UUID NOT NULL,
  "orderType" "OrderType" NOT NULL,
  "priority" "OrderPriority" NOT NULL,
  "hours" INTEGER NOT NULL,
  CONSTRAINT "tenant_sla_policies_pkey" PRIMARY KEY ("tenantId", "orderType", "priority"),
  CONSTRAINT "tenant_sla_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "tenant_sla_policies_hours_check" CHECK ("hours" BETWEEN 1 AND 240)
);

ALTER TABLE "orders"
  ADD COLUMN "slaHours" INTEGER,
  ADD COLUMN "slaWarningAt" TIMESTAMP(3),
  ADD COLUMN "slaSevereAt" TIMESTAMP(3);

CREATE INDEX "orders_slaWarningAt_idx" ON "orders"("slaWarningAt");
CREATE INDEX "orders_slaSevereAt_idx" ON "orders"("slaSevereAt");
