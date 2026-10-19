ALTER TABLE "retention_policies" ADD COLUMN "seriesLegalHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "retention_policies" ADD COLUMN "seriesLegalHoldReason" TEXT;
ALTER TABLE "retention_policies" ADD COLUMN "seriesLegalHoldAt" TIMESTAMP(3);
