"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PaperclipIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ProjectPanelSwitch } from "@/components/project-work-panels";
import { FilePreview, type DocumentRow } from "@/components/document-manager";
import { deleteDocument, restoreDocument } from "@/lib/actions/documents";
import { fmtDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";

export type ContractDocRow = {
  id: number;
  vendorName: string | null;
  amount: number;
  executedAt: string | null;
  createdAt: string;
  /** Filename off the storage path — just enough to preview it as the right
   *  file type, since "Signed contract — Ace Nationwide" carries no extension. */
  signedFileName: string | null;
};

export type BidDocRow = {
  id: number;
  vendorName: string | null;
  attachments: { id: number; name: string; createdAt: Date | string }[];
};

/** One row, whatever it came from. */
type Row = {
  key: string;
  name: string;
  date: Date;
  source: string;
  url: string;
  /** Only a plain uploaded document can be deleted from here — a bid's quote
   *  or a signed contract belongs to that record's own lifecycle. */
  deletable: number | null;
  typeHint?: string | null;
};

/**
 * Every real document filed against a project, in one place: what a vendor
 * quoted, what got signed, and whatever else was uploaded by hand.
 *
 * The three used to live in three different places — a bid's attachment
 * list, the contract dialog, and a "Documents" button buried in Manage — so
 * "what did the roofer actually send us" meant checking three screens. This
 * reads all three and adds nothing new to the data model: bids and contracts
 * already carried their files, this panel just also shows them.
 */
export function ProjectDocumentsPanel({
  propertyId,
  projectId,
  documents,
  bids,
  contracts,
}: {
  propertyId: number;
  projectId: number;
  documents: DocumentRow[];
  bids: BidDocRow[];
  contracts: ContractDocRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ name: string; url: string; typeHint?: string | null } | null>(
    null,
  );

  const rows: Row[] = [
    ...documents.map((d) => ({
      key: `doc-${d.id}`,
      name: d.name,
      date: d.createdAt ? new Date(d.createdAt) : new Date(0),
      source: "Document",
      url: `/api/properties/${propertyId}/projects/${projectId}/documents/${d.id}`,
      deletable: d.id,
    })),
    ...bids.flatMap((b) =>
      b.attachments.map((a) => ({
        key: `bid-${a.id}`,
        name: a.name,
        date: new Date(a.createdAt),
        source: `Bid · ${b.vendorName ?? "Unnamed vendor"}`,
        url: `/api/properties/${propertyId}/projects/${projectId}/bids/${b.id}/attachments/${a.id}`,
        deletable: null,
      })),
    ),
    ...contracts.map((c) => ({
      key: `contract-${c.id}`,
      name: `Signed contract — ${c.vendorName ?? "Unnamed vendor"} (${money(c.amount)})`,
      date: new Date(c.executedAt ?? c.createdAt),
      source: "Contract",
      url: `/api/projects/${projectId}/contract/signed?contract=${c.id}`,
      deletable: null,
      typeHint: c.signedFileName,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  async function upload(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/properties/${propertyId}/projects/${projectId}/documents`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Upload failed");
        return;
      }
      toast.success(`Uploaded ${file.name}`);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function remove(id: number, name: string) {
    startTransition(async () => {
      const res = await deleteDocument({ id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Deleted ${name}`, {
        action: {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              const undo = await restoreDocument({ id, propertyId, projectId });
              if (!undo.ok) toast.error(undo.error);
              router.refresh();
            }),
        },
      });
      router.refresh();
    });
  }

  return (
    <Card className="gap-0 overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-center gap-x-3 gap-y-2 pb-(--card-spacing)">
        <ProjectPanelSwitch />
        <span className="text-[13px] text-ink-400">
          {rows.length} document{rows.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto">
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
          <Button size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()}>
            <PaperclipIcon className="size-3.5" />
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
        </div>
      </CardHeader>

      <CardContent
        className={cn(
          "border-t border-border p-0",
          dragging && "bg-hover",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No documents yet. Vendor quotes and signed contracts filed elsewhere in this project
            will show up here automatically — or drop a file to add one by hand.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {rows.map((r) => (
              <li key={r.key} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <button
                  type="button"
                  onClick={() => setPreview({ name: r.name, url: r.url, typeHint: r.typeHint })}
                  className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium text-navy hover:text-link hover:underline"
                >
                  {r.name}
                </button>
                <span className="shrink-0 text-[11.5px] text-ink-400">{r.source}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(r.date)}</span>
                {r.deletable != null && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => remove(r.deletable!, r.name)}
                  >
                    Delete
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      {preview && (
        <FilePreview
          name={preview.name}
          url={preview.url}
          typeHint={preview.typeHint}
          onClose={() => setPreview(null)}
        />
      )}
    </Card>
  );
}
