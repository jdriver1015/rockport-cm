/**
 * Apply migration 0040 (renovation triggers). drizzle-kit migrate hangs on the
 * Supabase transaction pooler, so apply it here idempotently via the same
 * connection style as src/db/seed.ts.
 * Run: npx tsx scripts/apply-renovation-triggers.ts
 */
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (.env.local)");
  const client = postgres(url, { prepare: false, ssl: "require" });
  const db = drizzle(client);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "renovation_trigger_steps" (
      "id" serial PRIMARY KEY,
      "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
      "budget_group_id" integer NOT NULL REFERENCES "budget_groups"("id") ON DELETE CASCADE,
      "mode" text NOT NULL DEFAULT 'any',
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "renovation_trigger_steps_mode" CHECK ("mode" IN ('any', 'all'))
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "renovation_trigger_steps_property_idx"
      ON "renovation_trigger_steps" ("property_id", "sort_order")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "renovation_trigger_conditions" (
      "id" serial PRIMARY KEY,
      "step_id" integer NOT NULL REFERENCES "renovation_trigger_steps"("id") ON DELETE CASCADE,
      "text" text NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "renovation_trigger_conditions_step_idx"
      ON "renovation_trigger_conditions" ("step_id", "sort_order")`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "project_trigger_answers" (
      "id" serial PRIMARY KEY,
      "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
      "condition_id" integer REFERENCES "renovation_trigger_conditions"("id") ON DELETE SET NULL,
      "condition_text" text NOT NULL,
      "checked" boolean NOT NULL DEFAULT false,
      "recorded_by" uuid REFERENCES "profiles"("id"),
      "recorded_at" timestamptz NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "project_trigger_answers_project_idx"
      ON "project_trigger_answers" ("project_id")`);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "project_trigger_answers_unique_idx"
      ON "project_trigger_answers" ("project_id", "condition_id") WHERE "condition_id" IS NOT NULL`);

  // Prove the two behaviours the design depends on, rather than assuming the
  // DDL above landed on a fresh table.
  try {
    await db.execute(sql`
      INSERT INTO renovation_trigger_steps (property_id, budget_group_id, mode)
      VALUES (4, (SELECT id FROM budget_groups WHERE property_id = 4 LIMIT 1), 'nonsense')`);
    console.log("WARNING: a bad mode was ACCEPTED");
    await db.execute(sql`DELETE FROM renovation_trigger_steps WHERE mode = 'nonsense'`);
  } catch {
    console.log("mode CHECK refuses anything but any/all: ok");
  }

  // Deleting a condition must keep the answer, with its snapshot intact.
  const [step] = await db.execute<{ id: number }>(sql`
    INSERT INTO renovation_trigger_steps (property_id, budget_group_id, mode)
    VALUES (4, (SELECT id FROM budget_groups WHERE property_id = 4 LIMIT 1), 'any')
    RETURNING id`);
  const [cond] = await db.execute<{ id: number }>(sql`
    INSERT INTO renovation_trigger_conditions (step_id, text) VALUES (${step.id}, 'probe condition')
    RETURNING id`);
  const [proj] = await db.execute<{ id: number }>(sql`
    SELECT id FROM projects WHERE property_id = 4 LIMIT 1`);
  if (proj) {
    await db.execute(sql`
      INSERT INTO project_trigger_answers (project_id, condition_id, condition_text, checked)
      VALUES (${proj.id}, ${cond.id}, 'probe condition', true)`);
    await db.execute(sql`DELETE FROM renovation_trigger_conditions WHERE id = ${cond.id}`);
    const kept = await db.execute<{ condition_id: number | null; condition_text: string }>(sql`
      SELECT condition_id, condition_text FROM project_trigger_answers
      WHERE project_id = ${proj.id} AND condition_text = 'probe condition'`);
    console.log(
      kept.length === 1 && kept[0].condition_id === null
        ? "answer survives condition deletion with its wording: ok"
        : `PROBLEM: answer after condition delete = ${JSON.stringify(kept)}`,
    );
    await db.execute(
      sql`DELETE FROM project_trigger_answers WHERE condition_text = 'probe condition'`,
    );
  } else {
    console.log("(no project on property 4 — skipped the answer-survival probe)");
  }
  await db.execute(sql`DELETE FROM renovation_trigger_steps WHERE id = ${step.id}`);

  const tables = await db.execute<{ table_name: string }>(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_name IN ('renovation_trigger_steps', 'renovation_trigger_conditions', 'project_trigger_answers')
    ORDER BY table_name`);
  await client.end();
  console.log("tables:", tables.map((t) => t.table_name).join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
