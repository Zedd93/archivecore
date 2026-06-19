ALTER TABLE "transfer_list_items" ADD COLUMN "sourceBoxNumber" VARCHAR(100);

UPDATE "transfer_list_items" AS item
SET "sourceBoxNumber" = box."boxNumber"
FROM "boxes" AS box
WHERE item."boxId" = box."id"
  AND item."sourceBoxNumber" IS NULL;

CREATE INDEX "transfer_list_items_sourceBoxNumber_idx" ON "transfer_list_items"("sourceBoxNumber");
