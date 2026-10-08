CREATE TYPE "PriceListStatus" AS ENUM ('draft', 'active', 'archived');

CREATE TABLE "price_lists" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PLN',
  "validFrom" DATE NOT NULL,
  "validTo" DATE,
  "minimumMonthlyFee" DECIMAL(12,2),
  "status" "PriceListStatus" NOT NULL DEFAULT 'draft',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "price_list_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "priceListId" UUID NOT NULL,
  "serviceCode" VARCHAR(50) NOT NULL,
  "serviceName" VARCHAR(255) NOT NULL,
  "unit" VARCHAR(30) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 23,
  "minimumQuantity" DECIMAL(12,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "price_lists_tenantId_status_idx" ON "price_lists"("tenantId", "status");
CREATE INDEX "price_lists_tenantId_validFrom_idx" ON "price_lists"("tenantId", "validFrom");
CREATE UNIQUE INDEX "price_lists_one_active_per_tenant_idx" ON "price_lists"("tenantId") WHERE "status" = 'active';
CREATE UNIQUE INDEX "price_list_items_priceListId_serviceCode_key" ON "price_list_items"("priceListId", "serviceCode");
CREATE INDEX "price_list_items_serviceCode_idx" ON "price_list_items"("serviceCode");

ALTER TABLE "price_lists"
  ADD CONSTRAINT "price_lists_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "price_list_items"
  ADD CONSTRAINT "price_list_items_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "roles"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM jsonb_array_elements_text(
    "roles"."permissions"::jsonb || '["pricing.manage"]'::jsonb
  ) AS permission
)
WHERE "code" = 'DA'
  AND "tenantId" IS NULL;
