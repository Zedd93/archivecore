ALTER TABLE "tenants" ADD COLUMN "slaTargetPercent" INTEGER NOT NULL DEFAULT 95;
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_slaTargetPercent_check" CHECK ("slaTargetPercent" BETWEEN 1 AND 100);
