CREATE TABLE "order_handover_boxes" (
    "orderId" UUID NOT NULL,
    "boxId" UUID NOT NULL,
    "condition" VARCHAR(20) NOT NULL,
    "sealNumber" VARCHAR(100),
    "conditionNote" VARCHAR(1000),
    CONSTRAINT "order_handover_boxes_pkey" PRIMARY KEY ("orderId","boxId")
);

CREATE INDEX "order_handover_boxes_boxId_idx" ON "order_handover_boxes"("boxId");

ALTER TABLE "order_handover_boxes" ADD CONSTRAINT "order_handover_boxes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order_handover_proofs"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "order_handover_boxes" ADD CONSTRAINT "order_handover_boxes_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
