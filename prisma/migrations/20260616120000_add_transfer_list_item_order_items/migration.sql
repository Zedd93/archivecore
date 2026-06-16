ALTER TABLE "order_items" ADD COLUMN "transferListItemId" UUID;

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_transferListItemId_fkey"
  FOREIGN KEY ("transferListItemId") REFERENCES "transfer_list_items"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "order_items_transferListItemId_idx" ON "order_items"("transferListItemId");
