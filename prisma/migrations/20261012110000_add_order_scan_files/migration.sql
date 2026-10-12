ALTER TYPE "OrderType" ADD VALUE 'scan';

CREATE TABLE "order_scan_files" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "orderItemId" UUID NOT NULL,
  "storageKey" VARCHAR(1000) NOT NULL,
  "fileName" VARCHAR(500) NOT NULL,
  "fileSize" INTEGER NOT NULL,
  "checksumSha256" VARCHAR(64) NOT NULL,
  "pageCount" INTEGER NOT NULL,
  "uploadedById" UUID NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_scan_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_scan_files_orderItemId_key" ON "order_scan_files"("orderItemId");
CREATE INDEX "order_scan_files_tenantId_idx" ON "order_scan_files"("tenantId");
ALTER TABLE "order_scan_files" ADD CONSTRAINT "order_scan_files_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_scan_files" ADD CONSTRAINT "order_scan_files_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_scan_files" ADD CONSTRAINT "order_scan_files_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
