"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function RentRollUpload({
  propertyId,
  onDone,
}: {
  propertyId: number;
  /** Called after a successful upload (e.g. to close a containing dialog) */
  onDone?: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/properties/${propertyId}/rent-rolls/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not read rent roll");
        return;
      }
      toast.success(`Uploaded ${file.name} — parsing…`);
      onDone?.();
      // Land on the new batch; the detail page kicks off parsing + progress.
      router.push(`/properties/${propertyId}/rent-rolls/${data.batchId}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
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
        if (file) void handleFile(file);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xlsm,.xls,.csv,.pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <p className="font-medium text-navy">
        {busy ? "Uploading…" : "Drop a rent roll here"}
      </p>
      <p className="text-sm text-muted-foreground">
        or click to browse — Excel, CSV, or PDF. Columns are detected automatically, then reviewed.
      </p>
    </div>
  );
}
