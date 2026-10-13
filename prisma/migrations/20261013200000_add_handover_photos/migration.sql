CREATE TABLE "order_handover_photos" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "boxId" UUID,
    "storageKey" VARCHAR(1000) NOT NULL,
    "fileName" VARCHAR(500) NOT NULL,
    "mimeType" VARCHAR(50) NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksumSha256" VARCHAR(64) NOT NULL,
    "uploadedById" UUID NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_handover_photos_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_handover_photos_orderId_checksumSha256_key" ON "order_handover_photos"("orderId", "checksumSha256");
CREATE INDEX "order_handover_photos_tenantId_orderId_idx" ON "order_handover_photos"("tenantId", "orderId");
CREATE INDEX "order_handover_photos_boxId_idx" ON "order_handover_photos"("boxId");

ALTER TABLE "order_handover_photos" ADD CONSTRAINT "order_handover_photos_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_handover_photos" ADD CONSTRAINT "order_handover_photos_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_handover_proofs"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_handover_photos" ADD CONSTRAINT "order_handover_photos_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_handover_photos" ADD CONSTRAINT "order_handover_photos_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
