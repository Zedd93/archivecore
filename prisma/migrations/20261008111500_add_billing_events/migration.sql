CREATE TYPE "BillingEventStatus" AS ENUM ('unpriced', 'pending', 'excluded', 'invoiced');

CREATE TABLE "billing_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "priceListId" UUID,
  "priceListItemId" UUID,
  "orderId" UUID,
  "orderItemId" UUID,
  "serviceCode" VARCHAR(50) NOT NULL,
  "serviceName" VARCHAR(255) NOT NULL,
  "unit" VARCHAR(30) NOT NULL,
  "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(12,2),
  "netAmount" DECIMAL(12,2),
  "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 23,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'PLN',
  "sourceType" VARCHAR(50) NOT NULL,
  "sourceId" UUID NOT NULL,
  "description" VARCHAR(500),
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "billingPeriod" DATE NOT NULL,
  "status" "BillingEventStatus" NOT NULL DEFAULT 'unpriced',
  "excludedReason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_events_sourceType_sourceId_serviceCode_key"
  ON "billing_events"("sourceType", "sourceId", "serviceCode");
CREATE INDEX "billing_events_tenantId_billingPeriod_status_idx"
  ON "billing_events"("tenantId", "billingPeriod", "status");
CREATE INDEX "billing_events_tenantId_occurredAt_idx"
  ON "billing_events"("tenantId", "occurredAt");
CREATE INDEX "billing_events_orderId_idx" ON "billing_events"("orderId");

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_priceListId_fkey"
  FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_priceListItemId_fkey"
  FOREIGN KEY ("priceListItemId") REFERENCES "price_list_items"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "billing_events"
  ADD CONSTRAINT "billing_events_orderItemId_fkey"
  FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
