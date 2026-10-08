ALTER TABLE "billing_periods"
  ADD COLUMN "invoiceNumber" VARCHAR(100),
  ADD COLUMN "invoicedAt" TIMESTAMP(3),
  ADD COLUMN "invoicedById" UUID;

ALTER TABLE "billing_periods"
  ADD CONSTRAINT "billing_periods_invoicedById_fkey"
  FOREIGN KEY ("invoicedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
