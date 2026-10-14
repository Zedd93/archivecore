ALTER TABLE "custody_events" ADD COLUMN "orderNumberSnapshot" VARCHAR(50);

UPDATE "custody_events" AS event
SET "orderNumberSnapshot" = "orders"."orderNumber"
FROM "orders"
WHERE event."orderId" = "orders"."id";
