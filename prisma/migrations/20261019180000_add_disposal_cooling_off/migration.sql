ALTER TABLE "boxes" ADD COLUMN "disposalCoolingOffUntil" TIMESTAMP(3);

UPDATE "boxes"
SET "disposalCoolingOffUntil" = CURRENT_TIMESTAMP + INTERVAL '7 days'
WHERE "status" = 'approved_disposal' AND "deletedAt" IS NULL;
