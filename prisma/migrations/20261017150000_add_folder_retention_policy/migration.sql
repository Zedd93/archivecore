ALTER TABLE "folders" ADD COLUMN "retentionPolicyId" UUID;
CREATE INDEX "folders_retentionPolicyId_idx" ON "folders"("retentionPolicyId");
ALTER TABLE "folders" ADD CONSTRAINT "folders_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "retention_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
