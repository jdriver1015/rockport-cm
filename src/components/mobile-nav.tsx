"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The top nav, for anything narrower than a laptop.
 *
 * The desktop header lays a wordmark, four links, a name and a sign-out button
 * in one 64px row — that needs something like 900px, which rules out a phone
 * outright and an iPad too, in either orientation. Below `lg` the links
 * collapse behind this button instead.
 *
 * A full-screen takeover rather than a dropdown or a partial sheet: these are
 * destinations, not a short list of contextual actions, so each one gets a
 * large, centered, thumb-friendly target instead of being crowded into a
 * corner panel.
 */
export function MobileNav({
  links,
  who,
  signOut,
}: {
  links: { href: string; label: string }[];
  /** Name and role, shown at the foot of the sheet. */
  who: string | null;
  /** The sign-out form, rendered by the server so the action stays server-side. */
  signOut: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // A sheet over the page should not leave the page scrolling behind it.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="-mr-2 grid size-11 place-items-center rounded-control text-on-navy-muted transition-colors hover:text-white lg:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-navy pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] lg:hidden">
          {/* Same top-right corner the hamburger sits in, so the close
              control never moves when the menu opens. */}
          <div className="flex h-16 shrink-0 items-center justify-end px-4">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close menu"
              className="-mr-2 grid size-11 place-items-center rounded-control text-on-navy-muted hover:text-white"
            >
              <XIcon className="size-6" />
            </button>
          </div>

          <nav className="flex flex-1 flex-col items-center justify-center gap-2 px-6">
            {links.map((l) => {
              const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  // Closed here rather than by watching the pathname: the tap
                  // is the event, and syncing state to the route in an effect
                  // is a cascading render for something already known.
                  onClick={() => setOpen(false)}
                  className={cn(
                    // Large centered targets — the point of a full-screen
                    // takeover over a corner panel.
                    "rounded-control px-6 py-3 text-2xl font-medium transition-colors",
                    active ? "text-white" : "text-on-navy-muted hover:text-white",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
            {who && <span className="min-w-0 truncate text-xs text-on-navy-muted">{who}</span>}
            {signOut}
          </div>
        </div>
      )}
    </>
  );
}
