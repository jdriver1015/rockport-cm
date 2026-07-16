import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
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

export const projectKind = pgEnum("project_kind", ["unit", "common"]);

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
// Chart of accounts (portfolio-level master data)
// ---------------------------------------------------------------------------

export const costCategories = pgTable("cost_categories", {
  id: serial("id").primaryKey(),
  /** 4-digit lender code, e.g. "1100" */
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  /** High-level board grouping: exterior | amenities | interiors | fees (see src/lib/divisions.ts) */
  division: text("division"),
});

export const costCodes = pgTable("cost_codes", {
  id: serial("id").primaryKey(),
  categoryId: integer("category_id")
    .notNull()
    .references(() => costCategories.id),
  /** Full code, e.g. "1100-0001" */
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  /** 4000-series interior codes; unit projects spend across all of them */
  isInterior: boolean("is_interior").notNull().default(false),
  active: boolean("active").notNull().default(true),
}, (t) => [index("cost_codes_category_idx").on(t.categoryId)]);

// ---------------------------------------------------------------------------
// Properties (the assets)
// ---------------------------------------------------------------------------

export const properties = pgTable("properties", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  entity: text("entity"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  unitCount: integer("unit_count"),
  /** Source property-management system for GL exports, e.g. "BH / Yardi" */
  pmSystem: text("pm_system"),
  /** Latest GL activity date reflected in actuals — "GL Updated Thru" */
  glUpdatedThru: date("gl_updated_thru"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  /** This project's own planned cost (e.g. ~$12K for a unit turn) */
  budgetAmount: numeric("budget_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  /** Contracted amount (approved bid); actuals come from posted GL transactions */
  committedCost: numeric("committed_cost", { precision: 12, scale: 2 }).notNull().default("0"),
  vendorId: integer("vendor_id").references(() => vendors.id),
  startDate: date("start_date"),
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
}, (t) => [index("project_stage_events_project_idx").on(t.projectId)]);

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
// a link to the product. No pricing here; vendors price the scope via bid line
// items (see bidLineItems).
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
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** Soft-delete: hidden from the scope table but restorable. Null = active. */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
}, (t) => [index("scope_items_project_idx").on(t.projectId)]);

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
