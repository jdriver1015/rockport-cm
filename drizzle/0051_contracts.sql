-- Contracts: the document behind pre-con gate 5.

-- The boilerplate a contract is built from. Stored as text rather than an
-- uploaded PDF because the generated document has to interleave the terms with
-- an Exhibit A whose length varies with the scope — merging a fixed PDF cannot
-- do that, and rendering the whole thing keeps it one file with one page count.
CREATE TABLE IF NOT EXISTS "contract_templates" (
  "id" serial PRIMARY KEY,
  "name" text NOT NULL,
  "body" text NOT NULL,
  "is_default" boolean NOT NULL DEFAULT false,
  "version" integer NOT NULL DEFAULT 1,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "archived_at" timestamptz
);

-- One default, enforced rather than assumed: two defaults means the contract a
-- project generates depends on row order.
CREATE UNIQUE INDEX IF NOT EXISTS "contract_templates_one_default"
  ON "contract_templates" ("is_default") WHERE "is_default" AND "archived_at" IS NULL;

-- One row per attempt at getting a contract signed, not one per project. A
-- contract that is voided and reissued is two rows, and that history is the
-- answer to "why did this unit sit for three weeks".
CREATE TABLE IF NOT EXISTS "project_contracts" (
  "id" serial PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("id"),
  "bid_id" integer NOT NULL REFERENCES "bids"("id"),
  "template_id" integer REFERENCES "contract_templates"("id"),
  -- draft: generated, nobody has seen it.
  -- out_for_signature: with the vendor.
  -- vendor_signed: waiting on our countersignature.
  -- executed: both parties signed — the only status that meets the gate.
  -- voided: abandoned; a new row supersedes it.
  "status" text NOT NULL DEFAULT 'draft',
  -- Snapshot of the terms as generated. The template can be edited afterwards
  -- and what was signed must not change with it.
  "body_snapshot" text NOT NULL,
  "amount" numeric(12,2) NOT NULL,
  -- Set in phase C, when an e-signature provider is wired up.
  "provider_envelope_id" text,
  "storage_key" text,
  "sent_at" timestamptz,
  "vendor_signed_at" timestamptz,
  "countersigned_at" timestamptz,
  "executed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "created_by" uuid REFERENCES "profiles"("id"),
  CONSTRAINT "project_contracts_status" CHECK (status = ANY (ARRAY[
    'draft','out_for_signature','vendor_signed','executed','voided'])),
  -- Executed means executed. Without this the gate could be met by a row that
  -- says signed with no date to point at.
  CONSTRAINT "project_contracts_executed_has_date"
    CHECK (status <> 'executed' OR executed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS "project_contracts_project_idx" ON "project_contracts" ("project_id");

-- At most one contract in play per project. Voided rows are history and do not
-- count; two live contracts for one unit is a mistake, not a workflow.
CREATE UNIQUE INDEX IF NOT EXISTS "project_contracts_one_live"
  ON "project_contracts" ("project_id") WHERE status <> 'voided';
