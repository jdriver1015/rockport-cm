import {
  boolean,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Project lifecycle: setup → bidding → mobilization → in_progress → punch_walk → final_completion → closed */
export const projectStage = pgEnum("project_stage", [
  "setup",
  "bidding",
  "mobilization",
  "in_progress",
  "punch_walk",
  "final_completion",
  "closed",
]);

/** Unit turn lifecycle, mirrors the Unit Tracker workflow */
export const turnStage = pgEnum("turn_stage", [
  "planned",
  "vacant_ready",
  "in_progress",
  "punch",
  "complete",
  "invoiced",
  "leased",
]);

/** Scope grouping from the CapEX Cost Tracker sections */
export const scopeGroup = pgEnum("scope_group", [
  "exterior",
  "landscape",
  "amenity",
  "mep",
  "interior",
  "contingency_fee",
]);

export const scopeStatus = pgEnum("scope_status", [
  "not_started",
  "bidding",
  "in_progress",
  "complete",
  "deferred",
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

// ---------------------------------------------------------------------------
// Users (profile rows keyed to Supabase auth users)
// ---------------------------------------------------------------------------

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches supabase auth.users.id
  email: text("email").notNull().unique(),
  fullName: text("full_name"),
  role: userRole("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Chart of accounts (portfolio-level master data)
// ---------------------------------------------------------------------------

export const costCategories = pgTable("cost_categories", {
  id: serial("id").primaryKey(),
  /** 4-digit lender code, e.g. "1100" */
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const costCodes = pgTable("cost_codes", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => costCategories.id),
  /** Full code, e.g. "1100-0001" */
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** 4000-series interior codes roll up to unit turns instead of scopes */
  isInterior: boolean("is_interior").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  entity: text("entity"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  unitCount: integer("unit_count"),
  /** Source property-management system for GL exports, e.g. "BH / Yardi" */
  pmSystem: text("pm_system"),
  stage: projectStage("stage").notNull().default("setup"),
  startDate: date("start_date"),
  targetCompletion: date("target_completion"),
  /** Latest GL activity date reflected in actuals — "GL Updated Thru" */
  glUpdatedThru: date("gl_updated_thru"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projectStageEvents = pgTable("project_stage_events", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  fromStage: projectStage("from_stage"),
  toStage: projectStage("to_stage").notNull(),
  note: text("note"),
  userId: uuid("user_id").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Budget (underwriting) — one line per project per cost code
// ---------------------------------------------------------------------------

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: serial("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id),
    costCodeId: integer("cost_code_id")
      .notNull()
      .references(() => costCodes.id),
    /** Total underwritten amount for this code on this project */
    uwAmount: numeric("uw_amount", { precision: 12, scale: 2 }).notNull().default("0"),
    /** Interior codes: budget per unit; uwAmount = perUnitAmount × plannedUnits */
    perUnitAmount: numeric("per_unit_amount", { precision: 12, scale: 2 }),
    plannedUnits: integer("planned_units"),
    note: text("note"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("budget_lines_project_code_uq").on(t.projectId, t.costCodeId)],
);

// ---------------------------------------------------------------------------
// Vendors
// ---------------------------------------------------------------------------

export const vendors = pgTable("vendors", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  trade: text("trade"),
  contactName: text("contact_name"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Scopes & bids (CapEX Cost Tracker rows)
// ---------------------------------------------------------------------------

export const scopes = pgTable("scopes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  costCodeId: integer("cost_code_id")
    .notNull()
    .references(() => costCodes.id),
  name: text("name").notNull(),
  group: scopeGroup("group").notNull(),
  status: scopeStatus("status").notNull().default("not_started"),
  vendorId: integer("vendor_id").references(() => vendors.id),
  startDate: date("start_date"),
  completeDate: date("complete_date"),
  /** Contracted amount (approved bid); actuals come from posted GL transactions */
  committedCost: numeric("committed_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  percentComplete: integer("percent_complete").notNull().default(0),
  notes: text("notes"),
});

export const bids = pgTable("bids", {
  id: serial("id").primaryKey(),
  scopeId: integer("scope_id")
    .notNull()
    .references(() => scopes.id),
  vendorId: integer("vendor_id").references(() => vendors.id),
  bidNumber: integer("bid_number").notNull().default(1),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  receivedDate: date("received_date"),
  approved: boolean("approved").notNull().default(false),
  note: text("note"),
});

// ---------------------------------------------------------------------------
// Units & unit turns
// ---------------------------------------------------------------------------

export const units = pgTable("units", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  unitNumber: text("unit_number").notNull(),
  /** e.g. "B1Q" — floorplan + tier suffix as used on the Unit Tracker */
  floorplan: text("floorplan"),
  bedrooms: integer("bedrooms"),
  sqft: integer("sqft"),
  tier: unitTier("tier").notNull().default("classic"),
  occupied: boolean("occupied").notNull().default(false),
});

export const unitTurns = pgTable("unit_turns", {
  id: serial("id").primaryKey(),
  unitId: integer("unit_id")
    .notNull()
    .references(() => units.id),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  stage: turnStage("stage").notNull().default("planned"),
  startDate: date("start_date"),
  completeDate: date("complete_date"),
  /** Rent economics — drives trade-out $, %, and ROI */
  previousRent: numeric("previous_rent", { precision: 10, scale: 2 }),
  tradeOutRent: numeric("trade_out_rent", { precision: 10, scale: 2 }),
  inPlaceRent: numeric("in_place_rent", { precision: 10, scale: 2 }),
  leaseDate: date("lease_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const turnStageEvents = pgTable("turn_stage_events", {
  id: serial("id").primaryKey(),
  turnId: integer("turn_id")
    .notNull()
    .references(() => unitTurns.id),
  fromStage: turnStage("from_stage"),
  toStage: turnStage("to_stage").notNull(),
  userId: uuid("user_id").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const punchItems = pgTable("punch_items", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  unitTurnId: integer("unit_turn_id").references(() => unitTurns.id),
  scopeId: integer("scope_id").references(() => scopes.id),
  description: text("description").notNull(),
  status: punchStatus("status").notNull().default("open"),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// GL intake: import batches, transactions, mapping rules
// ---------------------------------------------------------------------------

export const importBatches = pgTable("import_batches", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  fileName: text("file_name").notNull(),
  /** Path of the original file in Supabase Storage */
  storagePath: text("storage_path"),
  sourceSystem: text("source_system"),
  status: batchStatus("status").notNull().default("uploaded"),
  rowCount: integer("row_count").notNull().default(0),
  autoMappedCount: integer("auto_mapped_count").notNull().default(0),
  needsReviewCount: integer("needs_review_count").notNull().default(0),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const glTransactions = pgTable("gl_transactions", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  batchId: integer("batch_id").references(() => importBatches.id),
  costCodeId: integer("cost_code_id").references(() => costCodes.id),
  scopeId: integer("scope_id").references(() => scopes.id),
  unitTurnId: integer("unit_turn_id").references(() => unitTurns.id),
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
});

export const mappingRules = pgTable("mapping_rules", {
  id: serial("id").primaryKey(),
  matchType: mappingMatchType("match_type").notNull(),
  /** The string to match: a GL account number, vendor name, or description keyword */
  pattern: text("pattern").notNull(),
  costCodeId: integer("cost_code_id")
    .notNull()
    .references(() => costCodes.id),
  /** Lower number wins when multiple rules match */
  priority: integer("priority").notNull().default(100),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Attachments (photos, invoices, lien waivers) — always stage-tagged
// ---------------------------------------------------------------------------

export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projects.id),
  scopeId: integer("scope_id").references(() => scopes.id),
  unitTurnId: integer("unit_turn_id").references(() => unitTurns.id),
  punchItemId: integer("punch_item_id").references(() => punchItems.id),
  glTransactionId: integer("gl_transaction_id").references(() => glTransactions.id),
  kind: attachmentKind("kind").notNull().default("photo"),
  storagePath: text("storage_path").notNull(),
  /** Project or turn stage at the moment of upload */
  stageTag: text("stage_tag"),
  caption: text("caption"),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  uploadedBy: uuid("uploaded_by").references(() => profiles.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
