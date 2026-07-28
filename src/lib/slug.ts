/**
 * URL-safe slugs for pretty routes. Properties persist a unique `slug` column
 * (regenerated on rename); projects don't — their name isn't guaranteed unique
 * (a unit that turns twice gets the same auto-generated name both times), so
 * project URLs are id-prefixed ("22-unit-001-interior") and always resolved by
 * the leading id, with the name suffix kept purely for readability.
 */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Appends -2, -3, ... until the slug isn't in `taken`. */
export function dedupeSlug(base: string, taken: Set<string>): string {
  const safeBase = base || "property";
  if (!taken.has(safeBase)) return safeBase;
  let i = 2;
  while (taken.has(`${safeBase}-${i}`)) i++;
  return `${safeBase}-${i}`;
}

export function projectSlug(project: { id: number; name: string }): string {
  const slug = slugify(project.name);
  return slug ? `${project.id}-${slug}` : String(project.id);
}

/** Reads the leading numeric id off a project route param; NaN if malformed. */
export function parseProjectId(param: string): number {
  const match = /^(\d+)/.exec(param);
  return match ? Number(match[1]) : NaN;
}
