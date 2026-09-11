"use client";

import { useEffect, useState } from "react";
import { ImageIcon, ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** Debounced so pasting a URL character-by-character doesn't fire a fetch per
 *  keystroke — a spec link is typed once and then sits still. */
function useProductPreview(url: string) {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = url.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!/^https?:\/\//i.test(trimmed)) {
        setImage(null);
        return;
      }
      fetch(`/api/link-preview?url=${encodeURIComponent(trimmed)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled) setImage(d?.image ?? null);
        })
        .catch(() => {});
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url]);

  return { image };
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** Just the thumbnail — a product's own og:image, or a plain fallback icon
 *  while there is none to show yet (or none published). */
export function ProductThumbnail({ url, size = 28 }: { url: string; size?: number }) {
  const { image } = useProductPreview(url);
  const style = { width: size, height: size };

  if (!image) {
    return (
      <span
        style={style}
        className="flex shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted text-ink-200"
      >
        <ImageIcon style={{ width: size * 0.5, height: size * 0.5 }} />
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={image}
      alt=""
      style={style}
      className="shrink-0 rounded-[5px] border border-border object-cover"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}

/** The read-only chip a spec row wears: thumbnail, name, and the link itself
 *  as a clean host-name pill rather than a raw pasted URL. */
export function ProductLinkChip({
  name,
  url,
  className,
}: {
  name: string;
  url: string;
  className?: string;
}) {
  const host = hostnameOf(url);

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-[6px] border border-border bg-card py-1 pr-2.5 pl-1 text-[11px] transition-colors hover:border-ink-200",
        className,
      )}
    >
      {url && <ProductThumbnail url={url} size={26} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-ink-700">{name || "—"}</span>
        {host && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            // The row this sits in opens an edit popover on click; the link
            // inside it should navigate instead, not also pop the editor open.
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 truncate text-link hover:underline"
          >
            <ExternalLinkIcon className="size-2.5 shrink-0" />
            {host}
          </a>
        )}
      </span>
    </span>
  );
}
