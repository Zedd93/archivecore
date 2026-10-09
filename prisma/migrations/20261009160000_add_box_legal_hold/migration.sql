-- Preserve existing boxes; a hold is inactive until explicitly set.
ALTER TABLE "boxes" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "boxes" ADD COLUMN "legalHoldReason" TEXT;
ALTER TABLE "boxes" ADD COLUMN "legalHoldAt" TIMESTAMP(3);
