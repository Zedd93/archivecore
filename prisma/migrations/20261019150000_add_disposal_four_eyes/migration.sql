ALTER TABLE "boxes"
  ADD COLUMN "disposalProposalBatchId" UUID,
  ADD COLUMN "disposalFourEyesRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "disposalFirstApprovedById" UUID,
  ADD COLUMN "disposalSecondApprovedById" UUID,
  ADD COLUMN "disposalSecondApprovedAt" TIMESTAMP(3);

CREATE INDEX "boxes_disposalProposalBatchId_idx" ON "boxes"("disposalProposalBatchId");
