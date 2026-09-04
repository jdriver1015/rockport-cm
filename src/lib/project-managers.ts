/**
 * Project-manager vocabulary: who can hold the role, and how a person reads.
 *
 * Deliberately free of any database import. The board's manager cell is a client
 * component and needs `managerInitials` and `ManagerOption`; when these lived
 * beside the roster queries, importing either one dragged `db()` — and through
 * it the `postgres` driver, and through that `fs`, `net`, `tls` and
 * `perf_hooks` — into the browser bundle, and the build failed on four
 * unresolvable node built-ins. The reads live in manager-roster.ts.
 */

/**
 * Who can be named a project manager.
 *
 * The write-capable roles, and only those. A PM is expected to resolve the
 * project's gates — book the walk, confirm the scope, award the bid — and every
 * one of those is a write, so naming a `site` or `viewer` would create an
 * assignment its holder cannot act on. This is deliberately the same pair
 * canWriteProperty admits; if the two ever need to diverge, that is a product
 * decision and this constant is where it lands.
 */
export const MANAGER_ROLES = ["admin", "cm"] as const;

export type ManagerOption = {
  id: string;
  /** Full name where the profile has one, email otherwise — never blank. */
  name: string;
  /** The picker's second line, so two people sharing a display name are separable. */
  email: string;
};

/** The name to show for a profile. Email is the fallback; a blank cell is not. */
export function managerName(fullName: string | null, email: string): string {
  const trimmed = fullName?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : email;
}

/**
 * Up to two letters for the avatar chip.
 *
 * Initials off a name; off the local part of an email when that is all there is,
 * because "JD" beats "JD@" and a chip has room for neither. Always returns
 * something — an empty chip reads as a rendering bug, not as missing data.
 */
export function managerInitials(name: string): string {
  const local = name.includes("@") ? name.slice(0, name.indexOf("@")) : name;
  const words = local.split(/[\s._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
