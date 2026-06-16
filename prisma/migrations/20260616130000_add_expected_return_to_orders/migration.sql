ALTER TABLE "orders" ADD COLUMN "expectedReturnAt" TIMESTAMP(3);

CREATE INDEX "orders_expectedReturnAt_idx" ON "orders"("expectedReturnAt");
