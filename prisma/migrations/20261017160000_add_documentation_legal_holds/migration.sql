ALTER TABLE "folders" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "folders" ADD COLUMN "legalHoldReason" TEXT;
ALTER TABLE "folders" ADD COLUMN "legalHoldAt" TIMESTAMP(3);

ALTER TABLE "documents" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "documents" ADD COLUMN "legalHoldReason" TEXT;
ALTER TABLE "documents" ADD COLUMN "legalHoldAt" TIMESTAMP(3);

ALTER TABLE "transfer_lists" ADD COLUMN "legalHold" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transfer_lists" ADD COLUMN "legalHoldReason" TEXT;
ALTER TABLE "transfer_lists" ADD COLUMN "legalHoldAt" TIMESTAMP(3);
