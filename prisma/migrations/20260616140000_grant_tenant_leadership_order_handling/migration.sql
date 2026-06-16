UPDATE "roles"
SET "permissions" = (
  SELECT jsonb_agg(DISTINCT permission)
  FROM jsonb_array_elements_text(
    "roles"."permissions"::jsonb || '["order.approve", "order.process", "order.complete"]'::jsonb
  ) AS permission
)
WHERE "code" = 'TL'
  AND "tenantId" IS NULL;
