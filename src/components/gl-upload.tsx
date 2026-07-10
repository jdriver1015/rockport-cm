"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function GlUpload({ propertyId }: { propertyId: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleFile(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/properties/${propertyId}/gl/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not read GL file");
        return;
      }
      const bits = [
        `${data.rowCount} rows`,
        `${data.autoMappedCount} auto-mapped`,
        `${data.needsReviewCount} need review`,
      ];
      if (data.duplicates) bits.push(`${data.duplicates} possible duplicates`);
      toast.success(`Imported ${file.name}: ${bits.join(", ")}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
        dragging ? "border-[#1457a5] bg-[#e8edf2]" : "border-muted-foreground/25 hover:bg-muted/50",
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
        accept=".xlsx,.xlsm,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <p className="font-medium text-[#1b355d]">
        {busy ? "Reading GL file…" : "Drop a GL export here"}
      </p>
      <p className="text-sm text-muted-foreground">
        or click to browse — rows are auto-mapped to cost codes, then reviewed below
      </p>
    </div>
  );
}
