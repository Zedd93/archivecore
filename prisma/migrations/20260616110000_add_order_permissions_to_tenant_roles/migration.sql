UPDATE "roles"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM jsonb_array_elements_text("roles"."permissions"::jsonb || '["order.read", "order.create"]'::jsonb) AS permission
)
WHERE "code" IN ('TL', 'TE')
  AND "tenantId" IS NULL;
