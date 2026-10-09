CREATE TYPE "InventorySessionStatus" AS ENUM ('in_progress', 'completed');

CREATE TABLE "inventory_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "locationId" UUID NOT NULL,
  "locationPath" VARCHAR(500) NOT NULL,
  "expected" JSONB NOT NULL,
  "excludedCount" INTEGER NOT NULL DEFAULT 0,
  "status" "InventorySessionStatus" NOT NULL DEFAULT 'in_progress',
  "startedById" UUID NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedById" UUID,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "inventory_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_scans" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sessionId" UUID NOT NULL,
  "boxId" UUID NOT NULL,
  "boxData" JSONB NOT NULL,
  "scannedById" UUID NOT NULL,
  "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voidedById" UUID,
  "voidedAt" TIMESTAMP(3),
  CONSTRAINT "inventory_scans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_sessions_tenantId_startedAt_idx" ON "inventory_sessions"("tenantId", "startedAt");
CREATE INDEX "inventory_scans_sessionId_voidedAt_scannedAt_idx" ON "inventory_scans"("sessionId", "voidedAt", "scannedAt");

ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_sessions" ADD CONSTRAINT "inventory_sessions_locationId_fkey"
  FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_scans" ADD CONSTRAINT "inventory_scans_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
