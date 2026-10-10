CREATE TYPE "HRRiaStatus" AS ENUM ('unknown', 'not_submitted', 'submitted');
CREATE TYPE "HRRetentionBasis" AS ENUM ('needs_review', 'pre_1999', 'transitional_50', 'transitional_ria', 'post_2018');

ALTER TABLE "hr_folders"
  ADD COLUMN "riaStatus" "HRRiaStatus" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "riaSubmittedAt" DATE,
  ADD COLUMN "retentionBasis" "HRRetentionBasis" NOT NULL DEFAULT 'needs_review',
  ADD COLUMN "retentionReviewRequired" BOOLEAN NOT NULL DEFAULT false;
