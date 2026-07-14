"use client";

import { useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { deleteDocument, restoreDocument } from "@/lib/actions/documents";

export type DocumentRow = {
  id: number;
  name: string;
  caption: string | null;
  createdAt: string | Date | null;
};

function getFileType(filename: string): "image" | "pdf" | "text" | "document" {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (["txt", "csv"].includes(ext)) return "text";
  return "document";
}

function DocumentPreview({
  propertyId,
  projectId,
  document,
  onClose,
}: {
  propertyId: number;
  projectId: number;
  document: DocumentRow;
  onClose: () => void;
}) {
  const fileType = getFileType(document.name);
  const docUrl = `/api/properties/${propertyId}/projects/${projectId}/documents/${document.id}`;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] flex flex-col"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle>{document.name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {fileType === "image" && (
            <img
              src={docUrl}
              alt={document.name}
              className="max-w-full h-auto mx-auto"
            />
          )}

          {fileType === "pdf" && (
            <iframe
              src={`${docUrl}#toolbar=0`}
              className="w-full h-full min-h-96"
              title={document.name}
            />
          )}

          {fileType === "text" && (
            <TextPreview docUrl={docUrl} />
          )}

          {fileType === "document" && (
            <div className="py-8 text-center text-muted-foreground">
              <p className="mb-4">Preview not available for this file type.</p>
              <a href={docUrl} download target="_blank" rel="noopener noreferrer">
                <Button>Download to view</Button>
              </a>
            </div>
          )}
        </div>

        <DialogFooter showCloseButton>
          <a href={docUrl} download target="_blank" rel="noopener noreferrer">
            <Button variant="outline">Download</Button>
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TextPreview({ docUrl }: { docUrl: string }) {
  const [content, setContent] = useState<string>("");
  const [error, setError] = useState<string>("");

  useEffect(() => {
    fetch(docUrl)
      .then((res) => res.text())
      .then((text) => setContent(text))
      .catch(() => setError("Failed to load preview"));
  }, [docUrl]);

  if (error) {
    return <div className="text-center text-red-600 py-4">{error}</div>;
  }

  if (!content) {
    return <div className="text-center text-muted-foreground py-4">Loading…</div>;
  }

  return (
    <pre className="bg-muted p-4 rounded-md text-xs overflow-auto max-h-96 whitespace-pre-wrap break-words">
      {content}
    </pre>
  );
}

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
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);

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
    startTransition(async () => {
      const res = await deleteDocument({ id: doc.id, propertyId, projectId });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            startTransition(async () => {
              const undo = await restoreDocument({ id: doc.id, propertyId, projectId });
              if (!undo.ok) toast.error(undo.error);
            });
          },
        },
      });
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
                <button
                  onClick={() => setPreviewDoc(doc)}
                  className="min-w-0 flex-1 truncate text-left font-medium text-navy hover:text-gold-link hover:underline cursor-pointer"
                >
                  {doc.name}
                </button>
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

        {previewDoc && (
          <DocumentPreview
            propertyId={propertyId}
            projectId={projectId}
            document={previewDoc}
            onClose={() => setPreviewDoc(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
