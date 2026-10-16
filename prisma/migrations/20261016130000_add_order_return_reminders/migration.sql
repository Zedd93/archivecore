CREATE TABLE "order_return_reminders" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "kind" VARCHAR(20) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_return_reminders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_return_reminders_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "order_return_reminders_orderId_kind_key" ON "order_return_reminders"("orderId", "kind");

-- Suppress a first-deploy burst for loans already overdue for more than a day.
INSERT INTO "order_return_reminders" ("orderId", "kind")
SELECT o."id", 'overdue' FROM "orders" o
WHERE o."orderType" = 'checkout'
  AND o."expectedReturnAt" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 day'
  AND o."status" IN ('delivered', 'completed')
  AND EXISTS (
    SELECT 1 FROM "order_items" i
    WHERE i."orderId" = o."id" AND i."itemStatus" = 'delivered'
  );
