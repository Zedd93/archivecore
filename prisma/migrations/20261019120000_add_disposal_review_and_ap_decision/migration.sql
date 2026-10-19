CREATE TYPE "ApDisposalDecision" AS ENUM ('consent_received', 'not_required');

ALTER TABLE "boxes"
  ADD COLUMN "disposalReviewedAt" TIMESTAMP(3),
  ADD COLUMN "disposalReviewedById" UUID,
  ADD COLUMN "disposalReviewNotes" TEXT,
  ADD COLUMN "apDecision" "ApDisposalDecision",
  ADD COLUMN "apDecisionReference" VARCHAR(200),
  ADD COLUMN "apDecisionDate" DATE,
  ADD COLUMN "apDecisionReason" TEXT,
  ADD COLUMN "apDecisionById" UUID,
  ADD COLUMN "apDecisionAt" TIMESTAMP(3);
