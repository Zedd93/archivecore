ALTER TYPE "BoxStatus" ADD VALUE IF NOT EXISTS 'approved_disposal';

UPDATE "roles"
SET "permissions" = "permissions" || '["disposal.approve"]'::jsonb
WHERE "code" = 'TL' AND "isSystem" = true
  AND jsonb_typeof("permissions") = 'array'
  AND NOT ("permissions" ? 'disposal.approve');

UPDATE "roles"
SET "permissions" = "permissions" || '["disposal.complete"]'::jsonb
WHERE "code" = 'DA' AND "isSystem" = true
  AND jsonb_typeof("permissions") = 'array'
  AND NOT ("permissions" ? 'disposal.complete');
