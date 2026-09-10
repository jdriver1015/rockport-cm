"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The top nav, for a phone.
 *
 * The desktop header lays a wordmark, four links, a name and a sign-out button
 * in one 64px row. At 375px that is roughly twice the available width, so below
 * `sm` the links collapse behind this button instead.
 *
 * A sheet rather than a dropdown: these are destinations, and a superintendent
 * reaching them one-handed wants targets nearer the thumb than the top-left
 * corner the menu button sits in.
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
        className="-mr-2 grid size-11 place-items-center rounded-control text-on-navy-muted transition-colors hover:text-white sm:hidden"
      >
        <MenuIcon className="size-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 sm:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-navy-deep/70"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-[14px] bg-navy pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_rgba(15,24,41,0.4)]">
            <div className="flex items-center justify-between px-5 pt-4 pb-2">
              <span className="text-[10.5px] font-semibold tracking-[0.14em] text-on-navy-muted uppercase">
                Menu
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="grid size-11 place-items-center rounded-control text-on-navy-muted hover:text-white"
              >
                <XIcon className="size-5" />
              </button>
            </div>

            <nav className="flex flex-col px-2 pb-2">
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
                      // 48px rows: a thumb target, not a mouse target.
                      "rounded-control px-3 py-3 text-[15px] font-medium transition-colors",
                      active ? "bg-white/10 text-white" : "text-on-navy-muted hover:text-white",
                    )}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
              {who && <span className="min-w-0 truncate text-xs text-on-navy-muted">{who}</span>}
              {signOut}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
