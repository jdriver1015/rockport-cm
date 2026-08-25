/**
 * Pure role-based access rules.
 *
 * Extracted from src/lib/auth.ts so the role/action matrix is testable without
 * Supabase, cookies, or the DB. The actual session/cookie plumbing lives in
 * src/lib/auth.ts and is exercised by the actions that call it.
 *
 * SCOPE (single-company CRM, no per-property membership table)
 * ------------------------------------------------------------
 * Today every authenticated user can read every property. Writes are reserved
 * for `admin` and `cm`. This is intentionally coarse — a per-property
 * membership table is the natural next step when a second company is added
 * or the team splits into regional groups. The action-call sites don't need
 * to change when that lands; only the matrix below.
 *
 * Matrix
 * ------
 *   admin   read ✓  write ✓  admin ✓
 *   cm      read ✓  write ✓  admin ✗
 *   site    read ✓  write ✗  admin ✗
 *   viewer  read ✓  write ✗  admin ✗
 *
 * Anything outside the enum (older DB rows, hand-edited values, future
 * additions) denies every action — fail closed, never open.
 */

export const AUTH_ROLES = ["admin", "cm", "site", "viewer"] as const;
export type AuthRole = (typeof AUTH_ROLES)[number];

export const AUTH_ACTIONS = ["read", "write", "admin"] as const;
export type AuthAction = (typeof AUTH_ACTIONS)[number];

const ROLE_TO_ACTIONS: Record<AuthRole, ReadonlyArray<AuthAction>> = {
  // admin: everything. Read + write + admin (which we don't currently use
  // to gate anything, but future "delete project" / "manage users" calls
  // will check it).
  admin: ["read", "write", "admin"],

  // cm: full read/write on every property. Today's CRM has a single
  // operations role that does underwriting review, GL review, project
  // setup, etc. Admin actions (user management, chart-of-accounts
  // deletion) remain admin-only.
  cm: ["read", "write"],

  // site: field person walking the property. Reads everything; no edits.
  // Adding site-only views (e.g. a photo-only feed) would not require any
  // change here — `site` already has full read scope.
  site: ["read"],

  // viewer: same read scope as site, kept as a separate role so a future
  // tightening (e.g. investor portal showing only budget + GL totals) can
  // collapse site/viewer into two distinct permission sets without
  // refactoring every call site.
  viewer: ["read"],
};

/**
 * The single matrix. Every role x action pair is decided here.
 *
 * Defensive against bad/expired roles: a role outside the typed enum
 * (which the type system blocks in normal code but not at the boundary
 * with a hand-edited DB) always returns false.
 */
export function roleAllowsAction(role: AuthRole, action: AuthAction): boolean {
  const allowed = ROLE_TO_ACTIONS[role];
  if (!allowed) return false;
  return allowed.includes(action);
}

/**
 * Convenience: "can this role view this property?" for read-side guards in
 * Server Components. Returns the same answer for every property today;
 * switches to (role, propertyId) once a membership table exists.
 */
export function canReadProperty(role: AuthRole): boolean {
  return roleAllowsAction(role, "read");
}

/**
 * Convenience: "can this role write this property?" Mutates projects,
 * GL transactions, budget lines, etc.
 */
export function canWriteProperty(role: AuthRole): boolean {
  return roleAllowsAction(role, "write");
}

/**
 * Convenience: "can this role do admin-only work?" User management,
 * permanent deletion, chart-of-accounts destruction. Currently every
 * writer (`admin`, `cm`) qualifies; kept separate so the next time we
 * split "delete project" from "edit project" there's a single place to
 * flip the gate.
 */
export function canAdminProperty(role: AuthRole): boolean {
  return roleAllowsAction(role, "admin");
}
