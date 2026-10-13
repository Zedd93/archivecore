CREATE TABLE "warehouse_operations" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "operationType" VARCHAR(20) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "warehouse_operations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "warehouse_operations_tenantId_createdAt_idx" ON "warehouse_operations"("tenantId", "createdAt");

ALTER TABLE "warehouse_operations" ADD CONSTRAINT "warehouse_operations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "warehouse_operations" ADD CONSTRAINT "warehouse_operations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
