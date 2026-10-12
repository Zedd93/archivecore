CREATE TABLE "integration_keys" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "keyHash" VARCHAR(64) NOT NULL,
    "keyPrefix" VARCHAR(24) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_keys_keyHash_key" ON "integration_keys"("keyHash");
CREATE INDEX "integration_keys_tenantId_revokedAt_idx" ON "integration_keys"("tenantId", "revokedAt");

ALTER TABLE "integration_keys" ADD CONSTRAINT "integration_keys_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "integration_keys" ADD CONSTRAINT "integration_keys_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
