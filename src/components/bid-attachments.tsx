"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaperclipIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { deleteBidAttachment, restoreBidAttachment } from "@/lib/actions/bid-attachments";

export type BidAttachmentRow = { id: number; name: string; createdAt: Date };

/**
 * Files filed against one bid — the vendor's own quote PDF, most often, for a
 * bid that came in outside the portal and so has no document of its own
 * anywhere else. A small list plus an upload button, not a dialog of its own:
 * this sits inside a row that already has plenty in it.
 */
export function BidAttachments({
  propertyId,
  projectId,
  bidId,
  attachments,
  archivedAttachments = [],
}: {
  propertyId: number;
  projectId: number;
  bidId: number;
  attachments: BidAttachmentRow[];
  /** Removed files for this bid — shown behind a "Show archived" toggle. */
  archivedAttachments?: BidAttachmentRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [showArchived, setShowArchived] = useState(false);

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `/api/properties/${propertyId}/projects/${projectId}/bids/${bidId}/attachments`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed");
        return;
      }
      toast.success(`Attached ${file.name}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function remove(id: number, name: string) {
    startTransition(async () => {
      const res = await deleteBidAttachment({ id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Removed ${name}`);
      router.refresh();
    });
  }

  function restore(id: number, name: string) {
    startTransition(async () => {
      const res = await restoreBidAttachment({ id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Restored ${name}`);
      router.refresh();
    });
  }

  return (
    <div className="min-w-0 flex-1 space-y-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {attachments.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1 text-[11.5px]">
            <a
              href={`/api/properties/${propertyId}/projects/${projectId}/bids/${bidId}/attachments/${a.id}`}
              target="_blank"
              rel="noreferrer"
              className="max-w-40 truncate text-link hover:underline"
              title={a.name}
            >
              {a.name}
            </a>
            <button
              type="button"
              aria-label={`Remove ${a.name}`}
              disabled={pending}
              onClick={() => remove(a.id, a.name)}
              className="text-ink-200 hover:text-alert"
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="h-6 px-1.5 text-[11.5px] text-muted-foreground"
        >
          <PaperclipIcon className="size-3" />
          {uploading ? "Uploading…" : attachments.length > 0 ? "Attach another" : "Attach file"}
        </Button>

        {archivedAttachments.length > 0 && (
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="text-[11.5px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {showArchived ? "Hide" : "Show"} archived ({archivedAttachments.length})
          </button>
        )}
      </div>

      {showArchived && archivedAttachments.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {archivedAttachments.map((a) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-300">
              <a
                href={`/api/properties/${propertyId}/projects/${projectId}/bids/${bidId}/attachments/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="max-w-40 truncate line-through hover:no-underline"
                title={a.name}
              >
                {a.name}
              </a>
              <button
                type="button"
                disabled={pending}
                onClick={() => restore(a.id, a.name)}
                className="text-link hover:underline"
              >
                Restore
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
