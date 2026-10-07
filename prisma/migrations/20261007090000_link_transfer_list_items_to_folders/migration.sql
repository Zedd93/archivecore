-- A transfer-list position is one archival folder. Folders may exist before a
-- physical box is assigned, so boxId becomes optional.
ALTER TABLE "folders" ALTER COLUMN "boxId" DROP NOT NULL;
ALTER TABLE "folders" ALTER COLUMN "folderNumber" TYPE VARCHAR(100);
ALTER TABLE "folders" ALTER COLUMN "title" TYPE VARCHAR(1000);

ALTER TABLE "transfer_list_items" ADD COLUMN "folderId" UUID;

-- Allocate stable folder identifiers first, then create one canonical folder
-- for every existing transfer-list item without changing the source records.
UPDATE "transfer_list_items"
SET "folderId" = gen_random_uuid()
WHERE "folderId" IS NULL;

INSERT INTO "folders" (
  "id",
  "boxId",
  "tenantId",
  "folderNumber",
  "title",
  "dateFrom",
  "dateTo",
  "description",
  "orderInBox",
  "status",
  "customFields",
  "createdAt",
  "updatedAt"
)
SELECT
  item."folderId",
  item."boxId",
  list."tenantId",
  item."folderSignature",
  item."folderTitle",
  item."dateFrom",
  item."dateTo",
  item."notes",
  item."ordinalNumber",
  'active'::"FolderStatus",
  jsonb_build_object(
    'source', 'transfer_list',
    'transferListId', item."transferListId",
    'transferListItemId', item."id"
  ),
  list."createdAt",
  list."updatedAt"
FROM "transfer_list_items" item
JOIN "transfer_lists" list ON list."id" = item."transferListId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "transfer_list_items" item
    LEFT JOIN "folders" folder ON folder."id" = item."folderId"
    WHERE item."folderId" IS NULL OR folder."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'Nie udało się utworzyć teczki dla każdej pozycji spisu ZO';
  END IF;
END $$;

ALTER TABLE "transfer_list_items" ALTER COLUMN "folderId" SET NOT NULL;

CREATE UNIQUE INDEX "transfer_list_items_folderId_key" ON "transfer_list_items"("folderId");

ALTER TABLE "transfer_list_items"
  ADD CONSTRAINT "transfer_list_items_folderId_fkey"
  FOREIGN KEY ("folderId") REFERENCES "folders"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing order items keep their source transfer-list relation and also gain
-- the canonical folder relation used by the rest of the application.
UPDATE "order_items" order_item
SET "folderId" = item."folderId"
FROM "transfer_list_items" item
WHERE order_item."transferListItemId" = item."id"
  AND order_item."folderId" IS NULL;
