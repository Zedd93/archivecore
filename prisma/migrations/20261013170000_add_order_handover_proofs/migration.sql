CREATE TABLE "order_handover_proofs" (
    "orderId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "recipientName" VARCHAR(120) NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_handover_proofs_pkey" PRIMARY KEY ("orderId")
);

CREATE INDEX "order_handover_proofs_recordedById_idx" ON "order_handover_proofs"("recordedById");

ALTER TABLE "order_handover_proofs" ADD CONSTRAINT "order_handover_proofs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_handover_proofs" ADD CONSTRAINT "order_handover_proofs_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
