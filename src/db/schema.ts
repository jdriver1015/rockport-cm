import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Domain shape
//
// property        — the asset (Retreat at Westpark). A container; its status
//                   is derived from its projects, it has no pipeline of its own.
// budget line     — UW benchmark per cost code per property. No status/photos.
// project         — the unit of work and of process: "Dog Park Fence",
//                   "Unit 614 Interior". Carries the stage pipeline, bids,
//                   photos, punch items. Coded to one cost code (common work),
//                   or kind='unit' where spend spans the 4000-series and the
//                   project holds its own total budget instead.
// Many projects can roll up under one UW line item.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Unified work-project lifecycle; stages may be skipped (e.g. units rarely bid) */
export const projectStage = pgEnum("project_stage", [
  "planned",
  "bidding",
  "ready",
  "in_progress",
  "punch",
  "complete",
  "invoiced",
  "closed",
]);

/**
 * The four operational phases a project moves through — see src/lib/stages.ts
 * for labels and the gate that must be satisfied to leave each one. Replaces
 * the eight-value `projectStage` above, which is being retired.
 */
/** Why a target date moved without a person moving it. */
export const slipReason = pgEnum("slip_reason", ["missed", "rebased"]);
export const budgetLockAction = pgEnum("budget_lock_action", ["locked", "unlocked"]);

export const projectPhase = pgEnum("project_phase", [
  "precon",
  "in_process",
  "punch",
  "complete",
]);

export const projectKind = pgEnum("project_kind", ["unit", "common"]);

/**
 * What happened to a bid request, in order.
 *
 * Sending one has always been a black hole: the row said "sent" and nothing
 * afterwards said whether anybody opened it, looked at the scope, or started
 * pricing. Chasing a vendor is the single most common thing somebody does with
 * this screen, and it was being done blind.
 */
export const bidEventKind = pgEnum("bid_event_kind", [
  "invited",
  "email_opened",
  "link_opened",
  "priced",
  "submitted",
  "revoked",
]);

/** GL transaction state within the intake pipeline */
export const txnStatus = pgEnum("txn_status", [
  "staged",
  "needs_review",
  "posted",
  "excluded",
]);

export const batchStatus = pgEnum("batch_status", [
  "uploaded",
  "parsed",
  "needs_mapping",
  "needs_accounts",
  "in_review",
  "posted",
  "failed",
]);

export const userRole = pgEnum("user_role", ["admin", "cm", "site", "viewer"]);

export const attachmentKind = pgEnum("attachment_kind", [
  "photo",
  "invoice",
  "lien_waiver",
  "document",
]);

export const mappingMatchType = pgEnum("mapping_match_type", [
  "gl_account",
  "vendor",
  "keyword",
]);

export const unitTier = pgEnum("unit_tier", ["classic", "upgraded", "renovated"]);

export const punchStatus = pgEnum("punch_status", ["open", "resolved"]);

/** Per-scope-line progress, rolled up by trade category on the project dashboard */
export const scopeItemStatus = pgEnum("scope_item_status", [
  "not_started",
  "in_progress",
  "complete",
  "blocked",
]);

export const auditStatus = pgEnum("audit_status", ["draft", "complete"]);

export const findingSeverity = pgEnum("finding_severity", ["low", "medium", "high"]);

export const findingStatus = pgEnum("finding_status", ["open", "resolved"]);

/**
 * How a scope item's quantity (and thus its total) is derived. Drives the
 * pricing engine (src/lib/pricing.ts):
 *  - sqft         → quantity = unit square footage
 *  - fixed        → quantity = 1
 *  - per_bedroom  → quantity = unit bedrooms
 *  - per_bathroom → quantity = unit bathrooms
 *  - per_window   → quantity = window count (not tracked yet → default quantity)
 *  - per_cabinet  → quantity = cabinet count (not tracked yet → default quantity)
 *  - percent      → total = unitPrice% of a base amount
 *  - formula      → quantity from a user-defined expression over unit attributes
 */
export const pricingMethod = pgEnum("pricing_method", [
  "sqft",
  "fixed",
  "per_bedroom",
  "per_bathroom",
  "per_window",
  "per_cabinet",
  "percent",
  "formula",
]);

/** Rent roll upload lifecycle: file staged → parsing → reviewed → committed snapshot */
export const rentRollBatchStatus = pgEnum("rent_roll_batch_status", [
  "uploaded",
  "parsing",
  "needs_review",
  "committed",
  "failed",
]);

/** Physical occupancy of a rent-roll unit row */
export const rentRollUnitStatus = pgEnum("rent_roll_unit_status", [
  "occupied",
  "notice",
  "vacant",
  "future",
]);

// ---------------------------------------------------------------------------
// Users (profile rows keyed to Supabase auth users)
// ---------------------------------------------------------------------------

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey(), // matches supabase auth.users.id
    email: text("email").notNull(),
    fullName: text("full_name"),
    role: userRole("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete: removed from the active roster but kept for FK history (stage events, uploads). */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  // Partial — lets a departed user's email be reused by a fresh roster entry.
  (t) => [uniqueIndex("profiles_email_uq").on(t.email).where(sql`${t.archivedAt} is null`)],
);

// ---------------------------------------------------------------------------
// Chart of accounts
//
// A chart is a named, self-contained set of categories + cost codes + mapping
// rules. The portfolio can hold several (e.g. a standard chart plus per-deal
// variants). Every property binds to exactly one chart at creation; that chart
// is locked in once the property has any GL activity (see chartOfAccountsId).
// Codes are unique WITHIN a chart, not globally.
// ---------------------------------------------------------------------------

export const chartsOfAccounts = pgTable(
  "charts_of_accounts",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    /** Exactly one chart is the portfolio default, pre-selected on new properties. */
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete: hidden from the chart list but restorable. Null = active. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  // Partial — at most one active default chart.
  (t) => [
    uniqueIndex("charts_of_accounts_default_uq")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true and ${t.archivedAt} is null`),
  ],
);

export const costCategories = pgTable(
  "cost_categories",
  {
    id: serial("id").primaryKey(),
    chartId: integer("chart_id")
      .notNull()
      .references(() => chartsOfAccounts.id),
    /** 4-digit lender code, e.g. "1100" */
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** High-level board grouping: exterior | amenities | interiors | fees (see src/lib/divisions.ts) */
    division: text("division"),
  },
  (t) => [uniqueIndex("cost_categories_chart_code_uq").on(t.chartId, t.code)],
);

export const costCodes = pgTable(
  "cost_codes",
  {
    id: serial("id").primaryKey(),
    // Denormalized onto the code (as well as living transitively via the category)
    // so chart-scoped lookups and the (chartId, code) uniqueness are a single hop.
    chartId: integer("chart_id")
      .notNull()
      .references(() => chartsOfAccounts.id),
    categoryId: integer("category_id")
      .notNull()
      .references(() => costCategories.id),
    /** Full code, e.g. "1100-0001" */
    code: text("code").notNull(),
    name: text("name").notNull(),
    /** 4000-series interior codes; unit projects spend across all of them */
    isInterior: boolean("is_interior").notNull().default(false),
    active: boolean("active").notNull().default(true),
  },
  (t) => [
    index("cost_codes_category_idx").on(t.categoryId),
    uniqueIndex("cost_codes_chart_code_uq").on(t.chartId, t.code),
  ],
);

// ---------------------------------------------------------------------------
// Properties (the assets)
// ---------------------------------------------------------------------------

export const properties = pgTable(
  "properties",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /** URL-safe handle derived from name, e.g. "retreat-at-westpark". Regenerated on rename. */
    slug: text("slug").notNull().unique(),
    // The chart this property's budget/GL codes live in. Chosen at creation and
    // locked once GL activity exists.
    chartOfAccountsId: integer("chart_of_accounts_id")
      .notNull()
      .references(() => chartsOfAccounts.id),
    entity: text("entity"),
    address: text("address"),
    city: text("city"),
    state: text("state"),
    unitCount: integer("unit_count"),
    /** Source property-management system for GL exports, e.g. "BH / Yardi" */
    pmSystem: text("pm_system"),
    /** Latest GL activity date reflected in actuals — "GL Updated Thru" */
    glUpdatedThru: date("gl_updated_thru"),
    /**
     * Set while the non-interior budget is locked against edits; null = unlocked.
     * Current state lives here for a cheap check at every write site; the full
     * history of who locked/unlocked and when is budgetLockEvents below.
     */
    budgetLockedAt: timestamp("budget_locked_at", { withTimezone: true }),
    budgetLockedBy: uuid("budget_locked_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Both set or both null — never one without the other. applyBudgetLockChange
    // is the only writer and always sets them together, but this is the backstop
    // against a future hand-run fix or a different code path doing it wrong.
    check("properties_budget_lock_pair_ck", sql`(${t.budgetLockedAt} is null) = (${t.budgetLockedBy} is null)`),
  ],
);

// ---------------------------------------------------------------------------
// Budget (underwriting benchmarks) — one line per property per cost code
// ---------------------------------------------------------------------------

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    costCodeId: integer("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    /** Total underwritten amount for this code on this property */
    uwAmount: numeric("uw_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Interior codes: budget per unit; uwAmount = perUnitAmount × plannedUnits */
    perUnitAmount: numeric("per_unit_amount", { precision: 12, scale: 2 }),
    plannedUnits: integer("planned_units"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete: hidden from the budget view but restorable. Null = active. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [
    // Partial — lets a re-added line for the same code reuse the slot once
    // the old one is archived, instead of colliding with it.
    uniqueIndex("budget_lines_property_code_uq")
      .on(t.propertyId, t.costCodeId)
      .where(sql`${t.archivedAt} is null`),
  ],
);

/**
 * Audit trail behind properties.budgetLockedAt/By — every lock and unlock of
 * a property's non-interior budget, who did it and when. The property's own
 * columns are only ever the latest state; this is what answers "who locked
 * this and when did it change" after the fact, mirroring projectActivityLog's
 * reasoning for the same kind of question on a project.
 */
export const budgetLockEvents = pgTable(
  "budget_lock_events",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    action: budgetLockAction("action").notNull(),
    userId: uuid("user_id").references(() => profiles.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("budget_lock_events_property_idx").on(t.propertyId)],
);

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  trade: text("trade"),
  /** Deactivate instead of delete once referenced by bids/projects */
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * People at a vendor. Portal-ready: when a contact is provisioned a login to
 * submit bids, a Supabase auth user is created and linked via profileId —
 * email is the future login identity, so it's globally unique.
 */
export const vendorContacts = pgTable("vendor_contacts", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id")
    .notNull()
    .references(() => vendors.id),
  name: text("name").notNull(),
  /** e.g. "Estimator", "Owner" */
  title: text("title"),
  email: text("email").unique(),
  phone: text("phone"),
  /** Shown on the vendor roster row */
  isPrimary: boolean("is_primary").notNull().default(false),
  /** Set when portal access is provisioned; null until then */
  profileId: uuid("profile_id").references(() => profiles.id),
  active: boolean("active").notNull().default(true),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("vendor_contacts_vendor_idx").on(t.vendorId)]);

// ---------------------------------------------------------------------------
// Units (inventory; a unit may have successive turn projects over time)
// ---------------------------------------------------------------------------

export const units = pgTable(
  "units",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    unitNumber: text("unit_number").notNull(),
    /** e.g. "B1Q" — floorplan + tier suffix as used on the Unit Tracker */
    floorplan: text("floorplan"),
    bedrooms: integer("bedrooms"),
    /** Fractional to allow 1.5/2.5 baths; populated from the rent roll */
    baths: numeric("baths", { precision: 4, scale: 1 }),
    sqft: integer("sqft"),
    tier: unitTier("tier").notNull().default("classic"),
    occupied: boolean("occupied").notNull().default(false),
  },
  (t) => [uniqueIndex("units_property_number_uq").on(t.propertyId, t.unitNumber)],
);

// ---------------------------------------------------------------------------
// Projects — the unit of work and process
// ---------------------------------------------------------------------------

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  name: text("name").notNull(),
  kind: projectKind("kind").notNull().default("common"),
  /**
   * The UW line item this project rolls up under. Set for common projects;
   * null for unit projects, whose transactions spread across the 4000-series.
   */
  costCodeId: integer("cost_code_id").references(() => costCodes.id),
  /** Unit projects only */
  unitId: integer("unit_id").references(() => units.id),
  stage: projectStage("stage").notNull().default("planned"),
  phase: projectPhase("phase").notNull().default("precon"),
  /** This project's own planned cost (e.g. ~$12K for a unit turn) */
  budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Contracted amount (approved bid); actuals come from posted GL transactions */
  committedCost: numeric("committed_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  vendorId: integer("vendor_id").references(() => vendors.id),
  budgetGroupId: integer("budget_group_id").references(() => budgetGroups.id),
  /** Interior turns: walk-through before work starts */
  /**
   * When the contract for this project was signed — the fourth pre-con gate.
   *
   * Just the fact, not the machinery. An e-signature flow and a generated
   * contract are coming, and all of them end by asserting a signing date, so the
   * eventual wizard fills this column rather than replacing it.
   */
  /**
   * When the scope was confirmed as ready to price — pre-con gate 2.
   *
   * Cleared when the RFPs that locked the scope are withdrawn, so re-opening
   * the scope for editing re-opens the gate rather than leaving it ticked
   * against something that has since changed.
   */
  scopeConfirmedAt: timestamp("scope_confirmed_at", { withTimezone: true }),
  contractSignedAt: date("contract_signed_at"),
  preWalkDate: date("pre_walk_date"),
  /**
   * Time of day for the pre-walk. A separate column rather than widening
   * preWalkDate to a timestamp: the schedule agenda, calendar and Gantt all
   * group and parse that column as a plain date string, and making it an instant
   * would reintroduce the timezone bug class that shifted dates by a day.
   */
  preWalkTime: time("pre_walk_time"),
  /**
   * When work ACTUALLY started — stamped on first entry to In Process, and
   * editable after the fact. Not a plan: the target start is the In Process
   * phase milestone's plannedDate (see project_milestones and
   * src/lib/schedule-data.ts).
   */
  startDate: date("start_date"),
  /**
   * SUPERSEDED — no longer written or read.
   *
   * The target finish is the `complete` phase milestone's plannedDate. This
   * column held a second copy of it, filled once by the interior wizard and
   * never updated again, so editing the target on the project page moved one
   * copy and left the Schedule views drawing the other. Kept because dropping a
   * column is a migration with no user-visible payoff.
   */
  targetCompletionDate: date("target_completion_date"),
  /** When work ACTUALLY finished — stamped on first entry to Complete. */
  completeDate: date("complete_date"),
  /** Rent economics — unit projects; drives trade-out $, %, and ROI */
  previousRent: numeric("previous_rent", { precision: 10, scale: 2 }),
  tradeOutRent: numeric("trade_out_rent", { precision: 10, scale: 2 }),
  inPlaceRent: numeric("in_place_rent", { precision: 10, scale: 2 }),
  leaseDate: date("lease_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from active views but keeps its budget/bid/GL history. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  index("projects_property_idx").on(t.propertyId),
  index("projects_cost_code_idx").on(t.costCodeId),
]);

/** Legacy phase log — superseded by projectActivityLog below (2026-08-19); kept
 *  read-only so history predating that change still shows in the Activity log. */
export const projectStageEvents = pgTable("project_stage_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  fromStage: projectStage("from_stage"),
  toStage: projectStage("to_stage").notNull(),
  fromPhase: projectPhase("from_phase"),
  toPhase: projectPhase("to_phase"),
  note: text("note"),
  userId: uuid("user_id").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("project_stage_events_project_idx").on(t.projectId)]);

/**
 * General-purpose field-change log for a project — one row per changed field
 * (phase advances, name/date/budget edits, milestone edits, etc.), rather than
 * the phase-only projectStageEvents above. `field` is a stable machine key
 * ("name", "phase", "milestone:label:plannedDate", ...) for future filtering;
 * `fieldLabel` is what's actually rendered, so the UI never needs a lookup
 * table to turn a key back into English. from/toValue are pre-formatted
 * display strings (already run through money()/fmtDate()/phaseLabel() etc.
 * at write time) — this table is a display log, not a source of truth to
 * recompute from, so it stores what the user actually saw change.
 */

/**
 * The boilerplate a contract is built from.
 *
 * Text, not an uploaded PDF: the generated document interleaves these terms with
 * an Exhibit A whose length varies with the scope, and merging a fixed PDF
 * cannot do that. Rendering the whole thing keeps it one file with one page
 * count — which is also what an e-signature provider wants.
 */
export const contractTemplates = pgTable("contract_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  body: text("body").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  /** Bumped on every save, so a stale editor cannot overwrite a newer one. */
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * One row per attempt at getting a contract signed — not one per project.
 *
 * A contract that is voided and reissued is two rows, and that history is the
 * answer to "why did this unit sit for three weeks". A partial unique index
 * keeps at most one non-voided row per project.
 */
export const projectContracts = pgTable("project_contracts", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  bidId: integer("bid_id")
    .notNull()
    .references(() => bids.id),
  templateId: integer("template_id").references(() => contractTemplates.id),
  /**
   * draft → out_for_signature → vendor_signed → executed, or voided.
   * Only executed meets the gate: a subcontract binds when both sides sign.
   */
  status: text("status").notNull().default("draft"),
  /**
   * The terms as they were when this contract was generated. The template can
   * be edited afterwards and what was signed must not change with it.
   */
  bodySnapshot: text("body_snapshot").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  /** Set in phase C, when an e-signature provider is wired up. */
  providerEnvelopeId: text("provider_envelope_id"),
  storageKey: text("storage_key"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  vendorSignedAt: timestamp("vendor_signed_at", { withTimezone: true }),
  countersignedAt: timestamp("countersigned_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => profiles.id),
}, (t) => [
  index("project_contracts_project_idx").on(t.projectId),
  /**
   * One live contract per AWARD, not per project.
   *
   * It was per project — "two live contracts for one unit is a mistake, not a
   * workflow" — which was true while a project had a single winner. A project
   * that lets its siding to one sub and its roofing to another is contracting
   * twice, on purpose, so the thing that must not be duplicated is the bid.
   */
  uniqueIndex("project_contracts_one_live_per_bid")
    .on(t.bidId)
    .where(sql`status <> 'voided'`),
]);

export const projectActivityLog = pgTable("project_activity_log", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  userId: uuid("user_id").references(() => profiles.id),
  field: text("field").notNull(),
  fieldLabel: text("field_label").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("project_activity_log_project_idx").on(t.projectId)]);

/**
 * Dated checkpoints on a project's timeline. Two dates carry the whole
 * mechanic: `plannedDate` is the target, `actualDate` is when it really
 * happened, and their difference is the schedule variance the dashboard shows.
 *
 * A milestone tied to a `phase` gets its `actualDate` stamped automatically the
 * first time the project enters that phase; untied milestones are set by hand.
 */
export const projectMilestones = pgTable("project_milestones", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  label: text("label").notNull(),
  /** Auto-stamps actualDate on first entry into this phase. Null = manual only. */
  phase: projectPhase("phase"),
  plannedDate: date("planned_date"),
  actualDate: date("actual_date"),
  /** What happened at this milestone — shown inline on the project timeline. */
  note: text("note"),
  /**
   * One of the four seeded phase milestones (see src/lib/milestones.ts). These
   * carry the phase auto-stamp that records when a project actually entered a
   * phase, so deleting one silently stops that phase being recorded — they are
   * protected from deletion and rename in src/lib/actions/milestones.ts.
   */
  isDefault: boolean("is_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from the timeline but restorable. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("project_milestones_project_idx").on(t.projectId)]);

/**
 * Every time a target date moved on its own.
 *
 * Targets are a living plan: when a phase is missed, it and everything after it
 * are pushed forward so the schedule stays a forecast rather than a work of
 * fiction. That is only safe because nothing is lost when a date moves — this
 * table is where it goes.
 *
 * It is also the post-mortem dataset. "How much do we slip in punch?" is a
 * group-by here, and the original commitment is recoverable without a baseline
 * column: the earliest `fromDate` for a milestone is what was first planned.
 *
 * `days` is BUSINESS days. A Friday miss noticed on Monday cost one working
 * day, not three, and every push lands on a weekday because crews do not
 * mobilise on a Saturday.
 */
export const milestoneSlipEvents = pgTable("milestone_slip_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  milestoneId: integer("milestone_id")
    .notNull()
    .references(() => projectMilestones.id),
  phase: projectPhase("phase").notNull(),
  fromDate: date("from_date").notNull(),
  toDate: date("to_date").notNull(),
  days: integer("days").notNull(),
  /** 'missed' — the date passed. 'rebased' — an actual was corrected after it. */
  reason: slipReason("reason").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("milestone_slip_events_project_idx").on(t.projectId, t.at),
  index("milestone_slip_events_phase_idx").on(t.phase, t.at),
]);

export const bids = pgTable("bids", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  /** Contact who submitted the bid — set internally today, by portal logins later */
  submittedByContactId: integer("submitted_by_contact_id").references(() => vendorContacts.id),
  bidNumber: integer("bid_number").notNull().default(1),
  receivedDate: date("received_date"),
  approved: boolean("approved").notNull().default(false),
  /**
   * Where this bid is in its life: draft, sent, received, awarded, declined.
   *
   * An RFP and a returned bid are the same shape — a bid with a line per scope
   * item — so sending seeds the lines at zero and the vendor fills them in,
   * rather than there being a second table for requests.
   */
  status: text("status").notNull().default("draft"),
  /**
   * How the work was let: "rfp" (sent out and priced) or "direct" (assigned
   * without competition). A direct award is still a bid row so the award,
   * committed cost and the contract all read off one place either way.
   */
  source: text("source").notNull().default("rfp"),
  /** Why competition was skipped. Required on a direct award, null otherwise. */
  awardReason: text("award_reason"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  /** When the vendor was asked to respond by. The first question they ask. */
  dueDate: date("due_date"),
  note: text("note"),
  /** Soft-delete: hidden from the bids list but restorable. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("bids_project_idx").on(t.projectId)]);

// A bid is built from line items: one per project scope item (the vendor's
// price for that part of the scope) plus any manual lines the vendor adds
// (labor, mobilization, etc.). The bid total is the sum of these — derived
// in queries, never stored.
export const bidLineItems = pgTable("bid_line_items", {
  id: serial("id").primaryKey(),
  bidId: integer("bid_id")
    .notNull()
    .references(() => bids.id, { onDelete: "cascade" }),
  /** The scope item this line prices; null for manual/labor lines */
  scopeItemId: integer("scope_item_id").references(() => scopeItems.id, {
    onDelete: "set null",
  }),
  /** Label snapshot — the scope text at bid time, or the manual line's description */
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("bid_line_items_bid_idx").on(t.bidId)]);

/**
 * The trail of a bid request: invited, opened, looked at, priced, submitted.
 *
 * Append-only. Nothing here is authoritative about the bid itself — the amounts
 * live on bid_line_items and the status on bids — this is only the record of
 * what the other side did and when, so "have they even seen it" has an answer.
 *
 * `meta` is deliberately small: a recipient address we already store on the
 * contact, or a count of lines changed. Not request bodies, not IP addresses.
 */
export const bidEvents = pgTable("bid_events", {
  id: serial("id").primaryKey(),
  bidId: integer("bid_id")
    .notNull()
    .references(() => bids.id, { onDelete: "cascade" }),
  kind: bidEventKind("kind").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  meta: jsonb("meta").$type<Record<string, string | number> | null>(),
}, (t) => [index("bid_events_bid_idx").on(t.bidId, t.at)]);

export const punchItems = pgTable("punch_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  description: text("description").notNull(),
  status: punchStatus("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("punch_items_project_idx").on(t.projectId)]);

// Scope: the spec list for a project — what work/materials, at what grade, and
// a link to the product. Vendors still price scope via bid line items, but
// interior turns generated from a budget group also carry their OWN estimate
// pricing (method + unit price + computed quantity); the line total is derived
// (quantity × unitPrice), and their sum seeds the project's budgetAmount.
export const scopeItems = pgTable("scope_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  item: text("item").notNull(),
  /** Spec notes — grade/quality of materials for this line */
  materialQuality: text("material_quality"),
  /** URL to the product/spec so anyone can view it online */
  productLink: text("product_link"),
  /** Trade section, e.g. "Cabinets", "Flooring" — snapshotted from the source scope-group item. Not currently surfaced in the scope table UI. */
  category: text("category"),
  /** Where this line stands; shown as a pill on the project's scope list. */
  /**
   * The pre-walk finding this line was written from, when it came from a walk.
   *
   * SET NULL on delete, not CASCADE: removing a finding must not remove the
   * scope line, and therefore the work, that it caused. Also lets the import
   * offer only the findings not yet taken.
   */
  sourceFindingId: integer("source_finding_id").references(() => auditFindings.id, {
    onDelete: "set null",
  }),
  status: scopeItemStatus("status").notNull().default("not_started"),
  /**
   * Trade partner doing this line. Distinct from the project's overall GC.
   *
   * Derived, not entered: written by the award that covers this line (see
   * applyAwardVendor in src/lib/award-coverage.ts) and cleared when that award
   * is taken back. It used to be typed in per line, which meant it recorded an
   * intention — a line could name a vendor nobody bid and no contract covered,
   * and the scope table reported it as settled.
   *
   * Rows predating that change may still hold a hand-entered vendor on a line
   * no award covers. Those are left as they are rather than wiped;
   * scripts/report-scope-vendor-mismatch.ts lists them.
   */
  vendorId: integer("vendor_id").references(() => vendors.id),
  /** This line's own window within the project schedule. */
  startDate: date("start_date"),
  endDate: date("end_date"),
  /**
   * Product specification grid for this line — `{ cols, rows }`, where rows is
   * an array of cell arrays parallel to cols. Held as jsonb rather than its own
   * table because the columns themselves vary per line (flooring specs and
   * fence specs share no headers), so there is no stable relational shape.
   */
  specs: jsonb("specs").$type<{ cols: string[]; rows: string[][] }>(),
  // --- Estimate pricing (set for template-generated interior scope; null for
  // legacy/manual spec-only items) ---
  /** 4000-series code this line reconciles to, for budget-vs-actual per code */
  costCodeId: integer("cost_code_id").references(() => costCodes.id),
  pricingMethod: pricingMethod("pricing_method"),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  /** Computed at generation from the method + unit metadata; editable in review */
  quantity: numeric("quantity", { precision: 12, scale: 2 }),
  /** Provenance: the scope_group_item this line was generated from (nullable, historical) */
  sourceGroupItemId: integer("source_group_item_id"),
  /** Provenance: the budget_group_line this line was generated from (nullable) */
  sourceBudgetLineId: integer("source_budget_line_id").references(() => budgetGroupLines.id),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from the scope table but restorable. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("scope_items_project_idx").on(t.projectId)]);

// ---------------------------------------------------------------------------
// Budget templates — standardized interior renovation packages.
//
// Two tiers:
//   1. Templates (budget_templates) — a portfolio-wide library managed under
//      Settings. Chart-independent: each line stores its 4000-series code as a
//      STRING (costCodeRef), resolved to a property's chart when instantiated.
//   2. Property budget groups (budget_groups) — the usable packages per
//      property, created from a template (lines cloned, costCodeRef resolved
//      to a costCodeId) or blank. The interior wizard picks from these.
//
// Each line is 1:1 with a cost code (UNIQUE constraint enforced in DB).
// A created project snapshots a group's lines into scope_items (pricing baked in).
// ---------------------------------------------------------------------------

export const budgetTemplates = pgTable("budget_templates", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  /**
   * Whether a new property inherits this type. Separate from `active`: a type
   * can be current and still be property-specific rather than portfolio
   * standard. The create form offers every active type either way — this only
   * decides what arrives pre-checked.
   */
  seedByDefault: boolean("seed_by_default").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

/**
 * Capability URLs that let a vendor price a scope without an account.
 *
 * One live token per bid. The token IS the authorisation: whoever holds the link
 * can read that bid's lines and write amounts on them, and nothing else — not
 * the project, not the property, not another vendor's bid.
 *
 * Stored literally rather than hashed. A hash would be right if this guarded
 * something sensitive, but the capability is a scope list and one vendor's own
 * prices, and read access to this table already implies read access to every bid.
 * In exchange the link stays re-copyable when a vendor loses it. Expiry and
 * revocation are the controls doing the work.
 */
export const bidAccessTokens = pgTable("bid_access_tokens", {
  id: serial("id").primaryKey(),
  bidId: integer("bid_id")
    .notNull()
    .references(() => bids.id, { onDelete: "cascade" }),
  /** 32 random bytes, base64url — long enough that guessing is not a threat. */
  token: text("token").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  /** Set to kill the link early. A reissue revokes whatever came before. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const budgetTemplateLines = pgTable(
  "budget_template_lines",
  {
    id: serial("id").primaryKey(),
    templateId: integer("template_id")
      .notNull()
      .references(() => budgetTemplates.id, { onDelete: "cascade" }),
    costCodeRef: text("cost_code_ref").notNull(),
    pricingMethod: pricingMethod("pricing_method").notNull().default("fixed"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
    defaultQuantity: numeric("default_quantity", { precision: 12, scale: 2 }),
    /**
     * Overrides the cost code's name as the display label. Cost code names are
     * chart-global, so without this a per-template pricing basis (e.g. "Quartz
     * counters 2cm $35/sf") can't be expressed.
     */
    description: text("description"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("budget_template_lines_template_idx").on(t.templateId),
    uniqueIndex("budget_template_lines_template_code_uq").on(t.templateId, t.costCodeRef),
  ],
);

export const budgetGroups = pgTable(
  "budget_groups",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    name: text("name").notNull(),
    description: text("description"),
    sourceTemplateId: integer("source_template_id").references(() => budgetTemplates.id),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    targetTradeOut: numeric("target_trade_out", { precision: 10, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("budget_groups_property_idx").on(t.propertyId)],
);

export const budgetGroupLines = pgTable(
  "budget_group_lines",
  {
    id: serial("id").primaryKey(),
    budgetGroupId: integer("budget_group_id")
      .notNull()
      .references(() => budgetGroups.id, { onDelete: "cascade" }),
    costCodeId: integer("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    pricingMethod: pricingMethod("pricing_method").notNull().default("fixed"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull().default("0"),
    defaultQuantity: numeric("default_quantity", { precision: 12, scale: 2 }),
    /** Overrides the cost code's chart-global name as the pivot row label. */
    description: text("description"),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("budget_group_lines_group_idx").on(t.budgetGroupId),
    uniqueIndex("budget_group_lines_group_code_uq").on(t.budgetGroupId, t.costCodeId),
  ],
);

// ---------------------------------------------------------------------------
// Interior budget plan — the two-dimensional renovation budget.
//
// Mirrors the underwriting methodology: a matrix of (unit group × upgrade tier),
// where each cell's per-unit cost is the tier's lines priced against that unit
// group's metadata, and the budget is Σ (per-unit cost × units planned).
//
//   interior_unit_groups          the pivot's columns ("1BR", "A1", "800-999 SF")
//   interior_unit_group_floorplans which rent-roll floorplans belong to a group
//   interior_budget_plan          how many units of each group get each tier
//   interior_budget_line_overrides pinned dollar amounts per cell
//   interior_budget_settings      CM / contingency rates + grouping mode
//
// The upgrade tier IS a budget_groups row; a tier appears as a column exactly
// when it has at least one interior_budget_plan row for the property.
// ---------------------------------------------------------------------------

export const interiorUnitGroups = pgTable(
  "interior_unit_groups",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    name: text("name").notNull(),
    /** Pricing metadata for per_bedroom / per_bathroom methods. */
    bedrooms: integer("bedrooms"),
    baths: numeric("baths", { precision: 4, scale: 1 }),
    /**
     * Unit count and average square footage are DERIVED — summed from
     * rent_roll_units through the floorplan map — so they can't go stale when a
     * new rent roll commits. These columns exist only to override that, for
     * pre-acquisition underwriting where no rent roll exists yet.
     */
    unitCountOverride: integer("unit_count_override"),
    avgSqftOverride: numeric("avg_sqft_override", { precision: 10, scale: 2 }),
    /** The committed batch this group was last reconciled against. */
    sourceBatchId: integer("source_batch_id").references(() => rentRollBatches.id),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("interior_unit_groups_property_idx").on(t.propertyId)],
);

export const interiorUnitGroupFloorplans = pgTable(
  "interior_unit_group_floorplans",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    unitGroupId: integer("unit_group_id")
      .notNull()
      .references(() => interiorUnitGroups.id, { onDelete: "cascade" }),
    floorPlanCode: text("floor_plan_code").notNull(),
  },
  (t) => [
    index("interior_unit_group_floorplans_group_idx").on(t.unitGroupId),
    // Keyed on the PROPERTY, not the group: a floorplan in two groups would
    // silently double-count its units in the budget.
    uniqueIndex("interior_unit_group_floorplans_property_code_uq").on(t.propertyId, t.floorPlanCode),
  ],
);

export const interiorBudgetPlan = pgTable(
  "interior_budget_plan",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    unitGroupId: integer("unit_group_id")
      .notNull()
      .references(() => interiorUnitGroups.id, { onDelete: "cascade" }),
    /** The upgrade tier — a budget_groups row (Enhanced, Signature, Designer). */
    budgetGroupId: integer("budget_group_id")
      .notNull()
      .references(() => budgetGroups.id, { onDelete: "cascade" }),
    /**
     * A whole count of units — you cannot renovate half an apartment. This was
     * fractional originally, so the pro-rata spread could tie to the penny
     * against the source underwriting workbook (which plans 70% of 293 units as
     * 205.1); the app now rounds, and so diverges from that workbook by a small
     * amount. Penetration is DERIVED from this over the group's unit count and is
     * never stored or entered.
     *
     * No row = tier not offered to this group. 0 = offered, none planned.
     */
    plannedUnits: integer("planned_units").notNull().default(0),
    note: text("note"),
  },
  (t) => [
    index("interior_budget_plan_property_idx").on(t.propertyId),
    uniqueIndex("interior_budget_plan_group_tier_uq").on(t.unitGroupId, t.budgetGroupId),
  ],
);

export const interiorBudgetLineOverrides = pgTable(
  "interior_budget_line_overrides",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    /**
     * Keyed on (budgetGroupId, costCodeId, unitGroupId) rather than a
     * budget_group_lines id on purpose: duplicateGroup re-inserts lines with
     * fresh ids and deleteGroupLine hard-deletes, so a line-id key would
     * silently discard every pin the first time someone duplicates a tier.
     * UNIQUE(budgetGroupId, costCodeId) on budget_group_lines already
     * guarantees this triple identifies at most one line.
     */
    budgetGroupId: integer("budget_group_id")
      .notNull()
      .references(() => budgetGroups.id, { onDelete: "cascade" }),
    costCodeId: integer("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    unitGroupId: integer("unit_group_id")
      .notNull()
      .references(() => interiorUnitGroups.id, { onDelete: "cascade" }),
    pricingMethod: pricingMethod("pricing_method").notNull().default("fixed"),
    /**
     * The unit price / rate for the override. Interpretation depends on
     * pricingMethod: "fixed" → finished dollar amount, "sqft" → $/sqft rate
     * (multiplied by the unit group's avgSqft at computation time).
     */
    amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
    /** Why this was pinned — "GC quote 6/12". The point of a pin is provenance. */
    note: text("note"),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("interior_budget_line_overrides_property_idx").on(t.propertyId),
    uniqueIndex("interior_budget_line_overrides_cell_uq").on(
      t.budgetGroupId,
      t.costCodeId,
      t.unitGroupId,
    ),
  ],
);

export const interiorBudgetSettings = pgTable("interior_budget_settings", {
  propertyId: integer("property_id")
    .primaryKey()
    .references(() => properties.id),
  /**
   * Uplift rates applied to each tier's per-unit scope total. Budget-only: they
   * never become scope lines on a project, so a unit project's budget stays real
   * scope cost and contingency isn't a cost code that reads permanently
   * underspent.
   */
  cmSupervisionPct: numeric("cm_supervision_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  contingencyPct: numeric("contingency_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  /**
   * Whether each uplift applies at all, kept separate from its rate so turning
   * one off for a budget cycle doesn't discard the figure. Zeroing the
   * percentage was previously the only way to switch one off, which made "off"
   * and "0%" indistinguishable.
   */
  cmEnabled: boolean("cm_enabled").notNull().default(true),
  contingencyEnabled: boolean("contingency_enabled").notNull().default(true),
  /**
   * Which cost codes the uplift dollars are attributed to. Without these the
   * uplifts would float outside the cost-code tree and the pivot's grand total
   * would stop reconciling to the Budget tab's Interiors division.
   */
  cmCostCodeId: integer("cm_cost_code_id").references(() => costCodes.id),
  contingencyCostCodeId: integer("contingency_cost_code_id").references(() => costCodes.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Portfolio-wide interior defaults a new property starts from — the same four
 * uplift fields as interiorBudgetSettings, one row for the whole portfolio.
 *
 * A singleton enforced by a CHECK rather than by convention: a second row would
 * quietly become a second answer to "what does a new property start with".
 *
 * Cost codes are stored as CODE STRINGS, not ids, because a default has to
 * outlive any one chart of accounts and each property picks its chart at
 * creation — the same reasoning as budgetTemplateLines.costCodeRef. A ref with
 * no match in the chosen chart has to surface at creation, or the property
 * starts with unattributed uplifts and its pivot silently stops reconciling to
 * the Budget tab's Interiors division.
 */
export const interiorDefaultSettings = pgTable("interior_default_settings", {
  id: integer("id").primaryKey().default(1),
  cmSupervisionPct: numeric("cm_supervision_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  contingencyPct: numeric("contingency_pct", { precision: 6, scale: 3 }).notNull().default("0"),
  cmEnabled: boolean("cm_enabled").notNull().default(true),
  contingencyEnabled: boolean("contingency_enabled").notNull().default(true),
  cmCostCodeRef: text("cm_cost_code_ref"),
  contingencyCostCodeRef: text("contingency_cost_code_ref"),
  /**
   * Suggested schedule for a new unit turn. False leaves the wizard's dates
   * blank rather than suggesting any.
   */
  scheduleEnabled: boolean("schedule_enabled").notNull().default(true),
  /**
   * Days from the day a project is created to each suggested date, keyed by
   * project PHASE rather than milestone label — the four defaults were renamed
   * once already and a phase key survives that. "pre_walk" is the exception: it
   * is not a milestone but the walk that produces the scope.
   *
   * All offsets share the one origin instead of chaining off each other, so
   * each suggested date is independently explainable. See
   * src/lib/schedule-defaults.ts.
   */
  scheduleOffsets: jsonb("schedule_offsets")
    .$type<Record<string, number>>()
    .notNull()
    .default({ pre_walk: 2, precon: 7, in_process: 10, punch: 24, complete: 28 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Written trade scope — the narrative a GC bids from. Pricing says what a turn
 * costs; this says what the work is.
 *
 * One table, two levels: a row belongs to EITHER a portfolio template (the
 * standard wording) or a property's renovation type (that property's departures
 * from it), enforced by a CHECK that exactly one is set. Two tables would mean
 * two of every query, action and component for text identical in shape, and the
 * copy path between levels would have to translate between them.
 *
 * `heading` is text, not a foreign key: the canonical thirteen live in
 * src/lib/trade-scope.ts and a property may add one the standard never
 * anticipated, so there is no closed set to point at. Unique per owner, so a
 * re-save replaces a trade's paragraph rather than appending a second one.
 */
export const tradeScopes = pgTable("trade_scopes", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").references(() => budgetTemplates.id, { onDelete: "cascade" }),
  budgetGroupId: integer("budget_group_id").references(() => budgetGroups.id, { onDelete: "cascade" }),
  heading: text("heading").notNull(),
  body: text("body"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Finish specs and the fixture kit — the tables a GC orders from.
 *
 * Trade scope is prose about responsibility; this is the exact colour, product,
 * model and vendor. Separate grids rather than one wide table because the
 * columns genuinely differ: paint needs colour / product / SW number / sheen,
 * flooring needs area and spec, appliances need model numbers.
 *
 * `grid` is {cols, rows} — the same shape scopeItems.specs already uses. A grid
 * rather than typed columns because each table's columns are its own, and a spec
 * sheet is read as a table, never queried by column.
 *
 * Same dual-owner shape as tradeScopes, with the same CHECK: the portfolio
 * template holds the standard, a property's type holds its departures.
 */
export const specTables = pgTable("spec_tables", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").references(() => budgetTemplates.id, { onDelete: "cascade" }),
  budgetGroupId: integer("budget_group_id").references(() => budgetGroups.id, { onDelete: "cascade" }),
  /** Which bid-sheet section this grid belongs under: "finish" or "fixture". */
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  grid: jsonb("grid").$type<{ cols: string[]; rows: string[][] }>().notNull().default({ cols: [], rows: [] }),
  /**
   * Optimistic-locking counter, bumped on every grid write. An integer rather
   * than updatedAt because timestamptz keeps microseconds and JavaScript Date
   * only milliseconds — a timestamp token read by a client never equals the
   * stored value, so every save would be refused as a conflict.
   */
  version: integer("version").notNull().default(1),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * How a unit gets assigned a renovation type at pre-walk, and the record of why
 * it did.
 *
 * Property-level, deliberately NOT hung off a renovation type: this is the rule
 * that decides BETWEEN types, so it cannot belong to one of them. Ordered steps,
 * and the first step whose condition is met assigns its type.
 */
export const renovationTriggerSteps = pgTable("renovation_trigger_steps", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id, { onDelete: "cascade" }),
  /** The type this step assigns. Cascades — a step pointing at a type that no
   *  longer exists would assign nothing while still reading as a working rule. */
  budgetGroupId: integer("budget_group_id")
    .notNull()
    .references(() => budgetGroups.id, { onDelete: "cascade" }),
  /** "any" — one checked condition fires the step. "all" — every one must be. */
  mode: text("mode").notNull().default("any"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("renovation_trigger_steps_property_idx").on(t.propertyId, t.sortOrder)]);

export const renovationTriggerConditions = pgTable("renovation_trigger_conditions", {
  id: serial("id").primaryKey(),
  stepId: integer("step_id")
    .notNull()
    .references(() => renovationTriggerSteps.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("renovation_trigger_conditions_step_idx").on(t.stepId, t.sortOrder)]);

/**
 * What the walker answered on one unit — the "Why Signature?" record.
 *
 * `conditionText` is the wording AS ANSWERED, snapshotted on purpose: the rule
 * gets edited over time, so without it rewording a condition would silently
 * rewrite the recorded justification for every unit already walked, and deleting
 * one would erase it. `conditionId` is SET NULL on delete for the same reason —
 * removing a condition from the rule must not remove the history.
 */
export const projectTriggerAnswers = pgTable("project_trigger_answers", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  conditionId: integer("condition_id").references(() => renovationTriggerConditions.id, {
    onDelete: "set null",
  }),
  conditionText: text("condition_text").notNull(),
  checked: boolean("checked").notNull().default(false),
  recordedBy: uuid("recorded_by").references(() => profiles.id),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("project_trigger_answers_project_idx").on(t.projectId)]);

// ---------------------------------------------------------------------------
// GL intake: import batches, transactions, mapping rules
// ---------------------------------------------------------------------------

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  fileName: text("file_name").notNull(),
  /** Path of the original file in Supabase Storage */
  storagePath: text("storage_path"),
  sourceSystem: text("source_system"),
  status: batchStatus("status").notNull().default("uploaded"),
  rowCount: integer("row_count").notNull().default(0),
  autoMappedCount: integer("auto_mapped_count").notNull().default(0),
  needsReviewCount: integer("needs_review_count").notNull().default(0),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  /** Reporting period / as-of date read from the file banner (YYYY-MM-DD) */
  periodDate: date("period_date"),
  /**
   * Pending account-section summaries while the batch awaits account selection.
   * Shape: { code, name, rowCount, total, suggested }[]. Cleared once the user
   * picks which accounts to import and the transactions are materialized.
   */
  accountSummary: jsonb("account_summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from the import history but restorable. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

export const glTransactions = pgTable("gl_transactions", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  batchId: integer("batch_id").references(() => importBatches.id),
  /** UW line item this spend reconciles to */
    costCodeId: integer("cost_code_id").references(() => costCodes.id),
    /**
     * The cost code this row was LAST POSTED AS, so an un-post / restore can
     * restore the original accounting. Set the first time a row moves to
     * `posted`; thereafter it is sticky and survives later corrections (those
     * corrections force the row back to `staged` and may overwrite costCodeId,
     * but originalCostCodeId stays pinned to the code that was actually posted).
     * See src/lib/gl-edit-rules.ts:originalCostCodeAfterEdit.
     */
    originalCostCodeId: integer("original_cost_code_id").references(() => costCodes.id),
    /** Work project this spend belongs to (JTD per project) */
    projectId: integer("project_id").references(() => projects.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  /** Vendor string exactly as it appeared in the source file */
  vendorRaw: text("vendor_raw"),
  description: text("description"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  txnDate: date("txn_date"),
  invoiceNo: text("invoice_no"),
  checkNo: text("check_no"),
  drawNo: text("draw_no"),
  /** Raw "Common Area/Unit No." value: a unit number, "General Exterior", "All Units", etc. */
  unitLabel: text("unit_label"),
  /** Source GL account number from the PM system, used by mapping rules */
  glAccountRaw: text("gl_account_raw"),
  status: txnStatus("status").notNull().default("staged"),
  excludeReason: text("exclude_reason"),
  /** Row number in the source file for drill-back */
  sourceRow: integer("source_row"),
  lienWaiver: boolean("lien_waiver").notNull().default(false),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Aggregations filter by property + status (posted actuals); batch/project/cost
  // code drive the ledger views. This is the table that grows with each import.
  index("gl_txn_property_status_idx").on(t.propertyId, t.status),
  index("gl_txn_batch_idx").on(t.batchId),
  index("gl_txn_project_idx").on(t.projectId),
  index("gl_txn_cost_code_idx").on(t.costCodeId),
]);

export const mappingRules = pgTable("mapping_rules", {
  id: serial("id").primaryKey(),
  // Rules resolve a raw GL account/vendor/keyword to a cost code within one chart.
  chartId: integer("chart_id")
    .notNull()
    .references(() => chartsOfAccounts.id),
  matchType: mappingMatchType("match_type").notNull(),
  /** The string to match: a GL account number, vendor name, or description keyword */
  pattern: text("pattern").notNull(),
  costCodeId: integer("cost_code_id")
    .notNull()
    .references(() => costCodes.id),
  /** Lower number wins when multiple rules match */
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  /**
   * Profile id of the user who first learned this rule. Sticky across later
   * priority tweaks: the upsert in src/lib/actions/gl.ts writes priority +
   * updatedAt on conflict but never overwrites createdBy, so the
   * "first-proposer" attribution is stable.
   */
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Per-property memory of which GL account sections are construction/CapEx.
 * Set when a user confirms the account-selection checklist during a GL import;
 * future imports of the same property auto-select the same accounts.
 */
export const glPropertyAccounts = pgTable(
  "gl_property_accounts",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    /** Account code exactly as printed in the PM export, e.g. "1740-0006" */
    accountCode: text("account_code").notNull(),
    /** Last-seen account name, for display */
    accountName: text("account_name"),
    /** True = import this account's rows; false = ignore it */
    isConstruction: boolean("is_construction").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gl_property_accounts_uq").on(t.propertyId, t.accountCode)],
);

/**
 * Learned column layouts keyed by a header fingerprint, so a repeat export from
 * the same PM system parses deterministically (skipping heuristics/AI). Written
 * when a user confirms a manual column mapping for an unrecognized format.
 */
export const glImportFormats = pgTable(
  "gl_import_formats",
  {
    id: serial("id").primaryKey(),
    /** Optional label, e.g. "Yardi" / "ResMan" */
    sourceSystem: text("source_system"),
    /** Hash of the normalized header labels */
    fingerprint: text("fingerprint").notNull(),
    /** Resolved column mapping: { headerRow, date, vendor, amount, debit, credit, ... } */
    columnMapping: jsonb("column_mapping").notNull(),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("gl_import_formats_fingerprint_uq").on(t.fingerprint)],
);

// ---------------------------------------------------------------------------
// Attachments (photos, invoices, lien waivers) — always stage-tagged
// ---------------------------------------------------------------------------

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  projectId: integer("project_id").references(() => projects.id),
  punchItemId: integer("punch_item_id").references(() => punchItems.id),
  glTransactionId: integer("gl_transaction_id").references(() => glTransactions.id),
  kind: attachmentKind("kind").notNull().default("photo"),
  storagePath: text("storage_path").notNull(),
  /** Project stage at the moment of upload */
  stageTag: text("stage_tag"),
  caption: text("caption"),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from the document list but restorable; the storage
   *  file is kept too (only a hard purge would ever remove it). Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("attachments_project_idx").on(t.projectId)]);

// ---------------------------------------------------------------------------
// Site audits — a walk-through of a property producing photo-backed findings,
// exportable as a branded report. Audit → findings → annotated photos.
// ---------------------------------------------------------------------------

export const siteAudits = pgTable("site_audits", {
  id: serial("id").primaryKey(),
  propertyId: integer("property_id")
    .notNull()
    .references(() => properties.id),
  /** Optional link to a specific work project */
  projectId: integer("project_id").references(() => projects.id),
  title: text("title").notNull(),
  /**
   * Which walk this is. A pre-walk produces the scope; a quality walk checks
   * work already done. They share every column and the same findings screen,
   * but the pre-con gate has to find THE pre-walk for a project, and "the
   * earliest audit" is not that. Text with a CHECK rather than an enum, so
   * adding a kind is a migration and not an enum alter.
   */
  kind: text("kind").notNull().default("quality"),
  auditDate: date("audit_date").notNull(),
  auditorName: text("auditor_name"),
  notes: text("notes"),
  status: auditStatus("status").notNull().default("draft"),
  createdBy: uuid("created_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from the list but restorable. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [
  index("site_audits_property_idx").on(t.propertyId),
  // The project dashboard reads a project's findings on every load.
  index("site_audits_project_idx").on(t.projectId),
]);

export const auditFindings = pgTable("audit_findings", {
  id: serial("id").primaryKey(),
  auditId: integer("audit_id")
    .notNull()
    .references(() => siteAudits.id),
  title: text("title").notNull(),
  description: text("description"),
  /** Area / location within the property */
  location: text("location"),
  severity: findingSeverity("severity").notNull().default("medium"),
  status: findingStatus("status").notNull().default("open"),
  assignee: text("assignee"),
  dueDate: date("due_date"),
  /** Manual ordering within the audit (ordering is a top user pain point) */
  sortIndex: integer("sort_index").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("audit_findings_audit_idx").on(t.auditId)]);

export const auditPhotos = pgTable("audit_photos", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id")
    .notNull()
    .references(() => auditFindings.id),
  /** Original uploaded image in Supabase Storage */
  storagePath: text("storage_path").notNull(),
  /** Flattened annotated render, if the photo has been marked up */
  annotatedPath: text("annotated_path"),
  /** Re-editable vector annotation overlay (shapes) */
  annotation: jsonb("annotation"),
  /** The note for this photo */
  caption: text("caption"),
  sortIndex: integer("sort_index").notNull().default(0),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  gpsLat: numeric("gps_lat", { precision: 9, scale: 6 }),
  gpsLng: numeric("gps_lng", { precision: 9, scale: 6 }),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("audit_photos_finding_idx").on(t.findingId)]);

// ---------------------------------------------------------------------------
// Rent rolls — per-property, point-in-time unit snapshots imported from PM
// exports (Yardi/ResMan/RealPage; Excel/CSV/PDF). A three-tier engine parses
// each upload (deterministic format replay → AI column mapper → heuristic),
// the result is reviewed, then committed. Every upload is kept as a dated
// snapshot (history), never auto-superseded — the "active" roll for a property
// is simply the most recent committed batch by as-of date. batch → units;
// mapping memory (formats, examples) is portfolio-global like the GL tables.
// ---------------------------------------------------------------------------

export const rentRollBatches = pgTable(
  "rent_roll_batches",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    fileName: text("file_name").notNull(),
    /** Path of the original file in Supabase Storage */
    storagePath: text("storage_path"),
    sourceSystem: text("source_system"),
    /** excel | csv | pdf */
    fileKind: text("file_kind"),
    status: rentRollBatchStatus("status").notNull().default("uploaded"),
    /** Snapshot as-of date read from the file banner (YYYY-MM-DD) */
    asOfDate: date("as_of_date"),
    rowCount: integer("row_count").notNull().default(0),
    occupiedCount: integer("occupied_count").notNull().default(0),
    vacantCount: integer("vacant_count").notNull().default(0),
    noticeCount: integer("notice_count").notNull().default(0),
    occupancyPct: numeric("occupancy_pct", { precision: 5, scale: 2 }),
    totalMarketRent: numeric("total_market_rent", { precision: 12, scale: 2 }),
    totalInPlaceRent: numeric("total_in_place_rent", { precision: 12, scale: 2 }),
    lossToLease: numeric("loss_to_lease", { precision: 12, scale: 2 }),
    /** format_replay | ai | heuristic | pdf_ai */
    parseMethod: text("parse_method"),
    /** 0–100 from the validation suite */
    confidenceScore: integer("confidence_score"),
    /** Live parse progress for client polling: { stage, pct } */
    parseProgress: jsonb("parse_progress"),
    parseAttempts: integer("parse_attempts").notNull().default(0),
    /** string[] of parser caveats surfaced on the review sheet */
    warnings: jsonb("warnings"),
    /**
     * Display rollups the review sheet renders without recomputing:
     * { floorplans, stats, mapping, rowFlags, rawSheet }. Units themselves
     * live as real rows in rentRollUnits.
     */
    extractedMeta: jsonb("extracted_meta"),
    errorMessage: text("error_message"),
    uploadedBy: uuid("uploaded_by").references(() => profiles.id),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Soft-delete: hidden from the snapshot history but restorable. Null = active. */
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => [index("rent_roll_batches_property_idx").on(t.propertyId)],
);

export const rentRollUnits = pgTable(
  "rent_roll_units",
  {
    id: serial("id").primaryKey(),
    propertyId: integer("property_id")
      .notNull()
      .references(() => properties.id),
    batchId: integer("batch_id")
      .notNull()
      .references(() => rentRollBatches.id),
    unitNumber: text("unit_number").notNull(),
    floorPlanCode: text("floor_plan_code"),
    beds: integer("beds"),
    baths: numeric("baths", { precision: 4, scale: 1 }),
    squareFeet: integer("square_feet"),
    marketRent: numeric("market_rent", { precision: 10, scale: 2 }),
    inPlaceRent: numeric("in_place_rent", { precision: 10, scale: 2 }),
    leaseStart: date("lease_start"),
    leaseEnd: date("lease_end"),
    moveInDate: date("move_in_date"),
    moveOutDate: date("move_out_date"),
    status: rentRollUnitStatus("status").notNull().default("vacant"),
    residentName: text("resident_name"),
    residentId: text("resident_id"),
    unitNotes: text("unit_notes"),
    /** Parser guessed a value on this row — surfaced in the review "Needs Review" list */
    needsReview: boolean("needs_review").notNull().default(false),
    reviewNote: text("review_note"),
    /** Row number in the source file for drill-back */
    sourceRow: integer("source_row"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rent_roll_units_property_batch_idx").on(t.propertyId, t.batchId),
    index("rent_roll_units_batch_idx").on(t.batchId),
  ],
);

/**
 * Learned rent-roll column layouts keyed by a header fingerprint. On a repeat
 * export from the same PM system the saved mapping replays deterministically,
 * skipping every AI call. Portfolio-global (no property_id).
 */
export const rentRollFormats = pgTable(
  "rent_roll_formats",
  {
    id: serial("id").primaryKey(),
    sourceSystem: text("source_system"),
    /** Hash of the normalized header labels */
    fingerprint: text("fingerprint").notNull(),
    /** Complete confirmed mapping: { headerRow, columns, statusMap, vacantMarkers, ... } */
    columnMapping: jsonb("column_mapping").notNull(),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rent_roll_formats_fingerprint_uq").on(t.fingerprint)],
);

/**
 * Few-shot hints fed to the AI column mapper: a raw header label seen in a
 * source file and the canonical field it mapped to. Grows as users confirm
 * rolls. Portfolio-global.
 */
export const rentRollMappingExamples = pgTable(
  "rent_roll_mapping_examples",
  {
    id: serial("id").primaryKey(),
    /** Raw header label seen in a source file, e.g. "Mkt Rent" */
    rawLabel: text("raw_label").notNull(),
    /** Canonical field it mapped to, e.g. "market_rent" */
    mappedTo: text("mapped_to").notNull(),
    createdBy: uuid("created_by").references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("rent_roll_mapping_examples_uq").on(t.rawLabel, t.mappedTo)],
);
