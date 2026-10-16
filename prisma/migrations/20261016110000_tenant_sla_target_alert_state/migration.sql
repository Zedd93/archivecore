CREATE TABLE "tenant_sla_target_alert_states" (
  "tenantId" UUID NOT NULL,
  "isBelow" BOOLEAN NOT NULL DEFAULT false,
  "lastNotifiedAt" TIMESTAMP(3),
  CONSTRAINT "tenant_sla_target_alert_states_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "tenant_sla_target_alert_states_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
