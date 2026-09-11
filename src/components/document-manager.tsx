"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

/** Preview any filed document by URL — a generic document, a bid's attached
 *  quote, or a project's signed contract all resolve to a signed-URL redirect
 *  and can be shown the same way. */
export function FilePreview({
  name,
  url,
  onClose,
  typeHint,
}: {
  name: string;
  url: string;
  onClose: () => void;
  /** The real filename, when `name` is a friendlier label with no extension
   *  of its own (e.g. "Signed contract — Ace Nationwide") — used only to tell
   *  what kind of preview to render. */
  typeHint?: string | null;
}) {
  const fileType = getFileType(typeHint || name);
  const docUrl = url;

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] flex flex-col"
        showCloseButton={true}
      >
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {fileType === "image" && (
            <Image
              src={docUrl}
              alt={name}
              width={1200}
              height={900}
              unoptimized
              className="mx-auto h-auto max-w-full"
            />
          )}

          {fileType === "pdf" && (
            <iframe
              src={`${docUrl}#toolbar=0`}
              className="w-full h-full min-h-96"
              title={name}
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
