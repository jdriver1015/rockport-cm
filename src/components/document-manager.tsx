"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { deleteDocument } from "@/lib/actions/documents";

export type DocumentRow = {
  id: number;
  name: string;
  caption: string | null;
  createdAt: string | Date | null;
};

export function DocumentManager({
  propertyId,
  projectId,
  documents,
}: {
  propertyId: number;
  projectId: number;
  documents: DocumentRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  async function upload(file: File) {
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  function remove(doc: DocumentRow) {
    if (!window.confirm(`Delete “${doc.name}”?`)) return;
    startTransition(async () => {
      const res = await deleteDocument({ id: doc.id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Deleted");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base text-navy">Documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-gold bg-paper" : "border-muted-foreground/25 hover:bg-muted/50",
          )}
          onClick={() => inputRef.current?.click()}
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
          <p className="font-medium text-navy">
            {busy ? "Uploading…" : "Drop a document here"}
          </p>
          <p className="text-sm text-muted-foreground">
            or click to browse — PDF, images, Office docs, csv, or txt (≤ 25 MB)
          </p>
        </div>

        {documents.length === 0 ? (
          <p className="py-2 text-center text-sm text-muted-foreground">No documents yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <a
                  href={`/api/properties/${propertyId}/projects/${projectId}/documents/${doc.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate font-medium text-navy hover:text-gold-link hover:underline"
                >
                  {doc.name}
                </a>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {fmtDate(doc.createdAt)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => remove(doc)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
