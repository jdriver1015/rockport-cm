# Plan: Security helpers (#6) + vendor-rule audit (#3)

## ROOT CAUSE

**#3 — `learnVendorRule` in src/lib/actions/gl.ts:31-58**
Inserts a row unconditionally on every correction. No audit trail of WHO/WHEN/FROM-WHICH-TXN;
no debounce; no user-attribution. Once learned, no UI exposes "delete this rule".

**#6 — Bigger than originally called.**
Verified by reading the relevant files:
- `createAdminClient()` uses service-role key → bypasses RLS
- Every server action calls `db()` directly with NO `await supabase.auth.getUser()`
- Only `/sign-in` redirect in `proxy.ts` is the access gate
- `ensureProfile.ts` exists but is unreferenced from any action

So the actual gap: any visitor who can POST a server action can read/write any property.
`userRole` is set on profiles but never enforced.

## PHASE 1 — SECURITY HELPERS

### A. Pure rules (no DB) — `src/lib/auth-rules.ts`

```ts
type Profile = { id: string; role: 'admin'|'cm'|'site'|'viewer' };

canReadProperty(profile): boolean
canWriteProperty(profile): boolean
canAdminProperty(profile): boolean

roleAllowsAction(role, action): boolean    // action = 'read'|'write'|'admin'
```

**Policy** (single-company CRM, no per-property membership table):
- `admin` → read, write, admin everywhere
- `cm` → read, write everywhere
- `site` → read everywhere
- `viewer` → read everywhere

(If a property-membership table gets added later, `can*Property` becomes a
`(profile, propertyId)` pair; the action-call sites don't change.)

### B. Active session + profile loader — `src/lib/auth.ts`

```ts
type LoadedProfile = { id: string; role: UserRole; email: string };

// Returns the active profile or an ActionResult-shaped error.
async function loadActiveProfile(): Promise<LoadedProfile | ActionError>;

// Convenience: every action calls this and short-circuits on error.
async function requireUser(): Promise<LoadedProfile>  // throws { ok:false, error }
```

Pulls user from `await createClient().auth.getUser()`, then looks up the row in
`profiles`. Re-uses `ensureProfile()` so first-time logins get a profile.

### C. TDD coverage (src/lib/auth-rules tests)

```
roleAllowsAction:
  - admin can admin, write, read
  - cm can read+write, not admin
  - site can read only
  - viewer can read only
  - unknown role denied everywhere

canReadProperty / canWriteProperty:
  - delegates to roleAllowsAction for each role
```

**Important**: `auth.ts` itself depends on Supabase cookies and DB — that's
"smoke test by wiring a real call" territory, not pure-function TDD. I'll layer
the helper into 3-5 actions and verify with `npm run typecheck` + the existing
`npm run build` (if it works without DB) — the assertions live at the rules layer.

## PHASE 2 — WIRE INTO ACTIONS

Touch the highest-risk actions only (this PR):
- `updateTransaction` (we're already here)
- `postTransaction`, `unpostTransaction`
- `excludeTransaction`, `restoreTransaction`
- `archiveProject` (the example called out in the review)

Each gets `const profile = await requireUser();` as line 1 — single DB call
(cookies + profile select), then proceeds. On error returns `{ ok:false, error }`.

A follow-up PR can do the full sweep.

## PHASE 3 — VENDOR RULE AUDIT (#3)

### A. Sticky `createdBy`

```ts
schema.mappingRules — add createdBy uuid references profiles.id  (nullable)
// On insert: createdBy = profile.id
// On conflict (priority update): set priority + updatedAt, KEEP createdBy
```

This gives a stable first-proposer attribution. The UI can later say
"Map 'ACME Plumbing' → 4625 was first proposed by Jimmy on Mar 14, 2026"
even after dozens of corrections.

### B. Minimum-confidence debounce

```ts
// Only learn a vendor rule when the vendor string appears at least twice in
// the CURRENT batch's auto-mapped rows. A single correction is almost always
// noise (typo fix); two or more confirms the mapping is real.
```

The cheaper implementation: count how many rows in the current batch's
auto-mapped set share `vendorRaw` and reference the same `costCodeId` (post-edit
or initial auto-map). If `count >= 2`, learn. One-row hits don't learn.

## VERIFICATION
- `npm run test` (10 existing + role/action tests)
- `npm run typecheck`
- `npm run lint`

## OUT OF SCOPE
- Adding a per-property `userPropertyAccess` table. Leave for when there's a
  real reason for one; the helper signature already accommodates it later.
- A Permissions UI in Settings → Users. Today's `user-editors.tsx` only
  sets the global role.
- Auditing every action in the app. Follow-up PR.
