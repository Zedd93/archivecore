ALTER TABLE "custody_events" ALTER COLUMN "boxId" DROP NOT NULL;
ALTER TABLE "custody_events" ADD COLUMN "folderId" UUID;
ALTER TABLE "custody_events" ADD COLUMN "documentId" UUID;
ALTER TABLE "custody_events" ADD COLUMN "hrFolderId" UUID;
ALTER TABLE "custody_events" ADD COLUMN "performedById" UUID;
ALTER TABLE "custody_events" ADD COLUMN "recipientName" VARCHAR(120);

CREATE INDEX "custody_events_folderId_idx" ON "custody_events"("folderId");
CREATE INDEX "custody_events_documentId_idx" ON "custody_events"("documentId");
CREATE INDEX "custody_events_hrFolderId_idx" ON "custody_events"("hrFolderId");
CREATE INDEX "custody_events_performedById_idx" ON "custody_events"("performedById");

ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_hrFolderId_fkey" FOREIGN KEY ("hrFolderId") REFERENCES "hr_folders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "custody_events" ADD CONSTRAINT "custody_events_one_target_check" CHECK (num_nonnulls("boxId", "folderId", "documentId", "hrFolderId") = 1);
