ALTER TABLE "order_items" ADD COLUMN "documentId" UUID;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_items_documentId_idx" ON "order_items"("documentId");
