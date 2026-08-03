-- Budget templates: collapse scope groups from one-to-many items into 1:1
-- cost-code budget lines.  Renames tables and migrates data.

BEGIN;

-- 1. Rename parent tables
ALTER TABLE scope_group_templates RENAME TO budget_templates;
ALTER TABLE scope_groups RENAME TO budget_groups;

-- 2. Rename projects FK column
ALTER TABLE projects RENAME COLUMN scope_group_id TO budget_group_id;

-- 3. Create budget_template_lines (collapsed from scope_group_template_items)
CREATE TABLE budget_template_lines (
  id            serial PRIMARY KEY,
  template_id   integer NOT NULL REFERENCES budget_templates(id) ON DELETE CASCADE,
  cost_code_ref text    NOT NULL,
  pricing_method pricing_method NOT NULL DEFAULT 'fixed',
  unit_price    numeric(12,2) NOT NULL DEFAULT '0',
  default_quantity numeric(12,2),
  notes         text,
  sort_order    integer NOT NULL DEFAULT 0,
  UNIQUE (template_id, cost_code_ref)
);
CREATE INDEX budget_template_lines_template_idx ON budget_template_lines(template_id);

-- Collapse: group by (template_id, cost_code_ref), sum unit_price, concat names
INSERT INTO budget_template_lines (template_id, cost_code_ref, pricing_method, unit_price, default_quantity, notes, sort_order)
SELECT
  template_id,
  cost_code_ref,
  -- Use the pricing method of the first item (lowest sort_order) in the group
  (ARRAY_AGG(pricing_method ORDER BY sort_order, id))[1] AS pricing_method,
  -- Sum unit prices within the group
  SUM(unit_price) AS unit_price,
  -- Take the first non-null default_quantity
  (ARRAY_AGG(default_quantity ORDER BY sort_order, id) FILTER (WHERE default_quantity IS NOT NULL))[1] AS default_quantity,
  -- Concatenate item names into notes
  STRING_AGG(
    COALESCE(name, '') || CASE WHEN notes IS NOT NULL AND notes <> '' THEN ' — ' || notes ELSE '' END,
    E'\n' ORDER BY sort_order, id
  ) AS notes,
  MIN(sort_order) AS sort_order
FROM scope_group_template_items
WHERE cost_code_ref IS NOT NULL
GROUP BY template_id, cost_code_ref;

-- 4. Create budget_group_lines (collapsed from scope_group_items)
CREATE TABLE budget_group_lines (
  id              serial PRIMARY KEY,
  budget_group_id integer NOT NULL REFERENCES budget_groups(id) ON DELETE CASCADE,
  cost_code_id    integer NOT NULL REFERENCES cost_codes(id),
  pricing_method  pricing_method NOT NULL DEFAULT 'fixed',
  unit_price      numeric(12,2) NOT NULL DEFAULT '0',
  default_quantity numeric(12,2),
  notes           text,
  sort_order      integer NOT NULL DEFAULT 0,
  UNIQUE (budget_group_id, cost_code_id)
);
CREATE INDEX budget_group_lines_group_idx ON budget_group_lines(budget_group_id);

INSERT INTO budget_group_lines (budget_group_id, cost_code_id, pricing_method, unit_price, default_quantity, notes, sort_order)
SELECT
  scope_group_id,
  cost_code_id,
  (ARRAY_AGG(pricing_method ORDER BY sort_order, id))[1] AS pricing_method,
  SUM(unit_price) AS unit_price,
  (ARRAY_AGG(default_quantity ORDER BY sort_order, id) FILTER (WHERE default_quantity IS NOT NULL))[1] AS default_quantity,
  STRING_AGG(
    COALESCE(name, '') || CASE WHEN notes IS NOT NULL AND notes <> '' THEN ' — ' || notes ELSE '' END,
    E'\n' ORDER BY sort_order, id
  ) AS notes,
  MIN(sort_order) AS sort_order
FROM scope_group_items
WHERE cost_code_id IS NOT NULL
GROUP BY scope_group_id, cost_code_id;

-- 5. Add provenance column on scope_items for new projects
ALTER TABLE scope_items ADD COLUMN source_budget_line_id integer REFERENCES budget_group_lines(id);

-- 6. Drop old item tables
DROP TABLE scope_group_template_items;
DROP TABLE scope_group_items;

-- 7. Rename indexes on renamed tables
ALTER INDEX IF EXISTS scope_groups_property_idx RENAME TO budget_groups_property_idx;

COMMIT;
