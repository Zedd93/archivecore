CREATE TABLE "order_sla_escalations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "orderId" UUID NOT NULL,
  "level" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "order_sla_escalations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "order_sla_escalations_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "order_sla_escalations_orderId_level_key" ON "order_sla_escalations"("orderId", "level");

-- Historical overdue orders must not trigger a burst of alerts on first deployment.
INSERT INTO "order_sla_escalations" ("orderId", "level")
SELECT "id", 120 FROM "orders"
WHERE "status" IN ('submitted', 'approved', 'in_progress', 'ready')
  AND "slaDeadline" <= CURRENT_TIMESTAMP;
