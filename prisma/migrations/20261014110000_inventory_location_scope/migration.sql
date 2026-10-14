-- Freeze the checked location hierarchy so historical reconciliations do not
-- change when a shelf or slot is later reorganized.
ALTER TABLE "inventory_sessions" ADD COLUMN "scopeLocationIds" JSONB;
