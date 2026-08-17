-- Product specification grid for a scope line: { cols, rows }, where rows is an
-- array of cell arrays parallel to cols. jsonb rather than its own table
-- because the columns vary per line (flooring specs and fence specs share no
-- headers), so there is no stable relational shape to model.
ALTER TABLE "scope_items" ADD COLUMN IF NOT EXISTS "specs" jsonb;
