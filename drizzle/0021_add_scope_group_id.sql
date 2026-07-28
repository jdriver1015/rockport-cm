ALTER TABLE "projects" ADD COLUMN "scope_group_id" integer REFERENCES "scope_groups"("id");--> statement-breakpoint

-- Backfill: for existing unit projects, resolve the scope group from their scope items.
UPDATE "projects" p
SET "scope_group_id" = sub.scope_group_id
FROM (
  SELECT DISTINCT ON (si."project_id")
    si."project_id",
    sgi."scope_group_id"
  FROM "scope_items" si
  JOIN "scope_group_items" sgi ON sgi."id" = si."source_group_item_id"
  WHERE si."source_group_item_id" IS NOT NULL
  ORDER BY si."project_id", si."id"
) sub
WHERE p."id" = sub."project_id"
  AND p."kind" = 'unit';
