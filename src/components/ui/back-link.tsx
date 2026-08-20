import Link from "next/link";

/**
 * One step back up, matching the "← Portfolio" idiom in PropertyHeader.
 *
 * Used instead of a breadcrumb trail on the screens nested under Unit Upgrades:
 * they are one level deep from a screen the reader just came from, and a
 * four-crumb trail spent more room restating where they already knew they were
 * than it did helping them leave.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <span aria-hidden>←</span>
      {label}
    </Link>
  );
}
