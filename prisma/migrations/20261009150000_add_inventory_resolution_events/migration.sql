CREATE TABLE "inventory_resolution_events" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "sequence" SERIAL NOT NULL,
  "sessionId" UUID NOT NULL,
  "boxId" UUID NOT NULL,
  "kind" VARCHAR(30) NOT NULL,
  "action" VARCHAR(20) NOT NULL,
  "note" TEXT NOT NULL,
  "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_resolution_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_resolution_events_sequence_key" UNIQUE ("sequence")
);

CREATE INDEX "inventory_resolution_events_sessionId_boxId_kind_sequence_idx"
  ON "inventory_resolution_events"("sessionId", "boxId", "kind", "sequence");

ALTER TABLE "inventory_resolution_events" ADD CONSTRAINT "inventory_resolution_events_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "inventory_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_resolution_events" ADD CONSTRAINT "inventory_resolution_events_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
