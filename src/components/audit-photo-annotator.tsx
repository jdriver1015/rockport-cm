"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Tool = "arrow" | "rect" | "ellipse" | "free" | "text";

type Shape =
  | { type: "arrow" | "rect" | "ellipse"; color: string; x1: number; y1: number; x2: number; y2: number }
  | { type: "free"; color: string; points: [number, number][] }
  | { type: "text"; color: string; x: number; y: number; text: string };

const COLORS = ["#e11d48", "#f59e0b", "#2563eb", "#16a34a", "#ffffff", "#111827"];
const MAX_SIDE = 1600;

export function AuditPhotoAnnotator({
  propertyId,
  auditId,
  photoId,
  stamp,
  onClose,
}: {
  propertyId: number;
  auditId: number;
  photoId: number;
  /** Optional GPS/timestamp line burned into the render */
  stamp?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<Tool>("arrow");
  const [color, setColor] = useState(COLORS[0]);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const drawAll = useCallback(
    (list: Shape[], inProgress: Shape | null) => {
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!canvas || !img) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const all = inProgress ? [...list, inProgress] : list;
      for (const s of all) drawShape(ctx, s, canvas.width);
      if (stamp) drawStamp(ctx, stamp, canvas.width, canvas.height);
    },
    [stamp],
  );

  // Load the original (proxied same-origin so the export isn't tainted).
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      imgRef.current = img;
      setReady(true);
    };
    img.onerror = () => toast.error("Could not load image to annotate");
    img.src = `/api/properties/${propertyId}/audits/${auditId}/photos/${photoId}?proxy=1`;
  }, [propertyId, auditId, photoId]);

  useEffect(() => {
    if (ready) drawAll(shapes, draft);
  }, [ready, shapes, draft, drawAll]);

  function toCanvas(e: React.PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) * canvas.width) / rect.width,
      ((e.clientY - rect.top) * canvas.height) / rect.height,
    ];
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    const [x, y] = toCanvas(e);
    if (tool === "text") {
      const text = window.prompt("Label text");
      if (text) setShapes((prev) => [...prev, { type: "text", color, x, y, text }]);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (tool === "free") setDraft({ type: "free", color, points: [[x, y]] });
    else setDraft({ type: tool, color, x1: x, y1: y, x2: x, y2: y });
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    const [x, y] = toCanvas(e);
    if (draft.type === "free") setDraft({ ...draft, points: [...draft.points, [x, y]] });
    else if (draft.type !== "text") setDraft({ ...draft, x2: x, y2: y });
  }

  function onPointerUp() {
    if (!draft) return;
    setShapes((prev) => [...prev, draft]);
    setDraft(null);
  }

  async function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    try {
      drawAll(shapes, null);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png"),
      );
      if (!blob) {
        toast.error("Could not render annotation");
        return;
      }
      const fd = new FormData();
      fd.append("file", new File([blob], "annotated.png", { type: "image/png" }));
      fd.append(
        "annotation",
        JSON.stringify({ v: 1, w: canvas.width, h: canvas.height, shapes }),
      );
      const res = await fetch(
        `/api/properties/${propertyId}/audits/${auditId}/photos/${photoId}/annotation`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Could not save annotation");
        return;
      }
      toast.success("Annotation saved");
      onClose();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>Annotate photo</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b pb-3">
          {(["arrow", "rect", "ellipse", "free", "text"] as Tool[]).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tool === t ? "default" : "outline"}
              onClick={() => setTool(t)}
            >
              {t === "rect" ? "box" : t}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              className={`size-6 rounded-full border ${color === c ? "ring-2 ring-offset-1 ring-navy" : ""}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            size="sm"
            variant="ghost"
            disabled={shapes.length === 0}
            onClick={() => setShapes((prev) => prev.slice(0, -1))}
          >
            Undo
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={shapes.length === 0}
            onClick={() => setShapes([])}
          >
            Clear
          </Button>
        </div>

        <div className="flex-1 overflow-auto bg-muted/30 p-2">
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="mx-auto max-w-full touch-none"
            style={{ cursor: "crosshair" }}
          />
        </div>

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || !ready}>
            {saving ? "Saving…" : "Save annotation"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- canvas drawing helpers -------------------------------------------------

function drawShape(ctx: CanvasRenderingContext2D, s: Shape, canvasWidth: number) {
  const lw = Math.max(2, Math.round(canvasWidth / 300));
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = lw;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  if (s.type === "rect") {
    ctx.strokeRect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
  } else if (s.type === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      (s.x1 + s.x2) / 2,
      (s.y1 + s.y2) / 2,
      Math.abs(s.x2 - s.x1) / 2,
      Math.abs(s.y2 - s.y1) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else if (s.type === "arrow") {
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
    const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const head = lw * 4;
    ctx.beginPath();
    ctx.moveTo(s.x2, s.y2);
    ctx.lineTo(s.x2 - head * Math.cos(angle - Math.PI / 6), s.y2 - head * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(s.x2 - head * Math.cos(angle + Math.PI / 6), s.y2 - head * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  } else if (s.type === "free") {
    ctx.beginPath();
    s.points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.stroke();
  } else if (s.type === "text") {
    const size = Math.max(16, Math.round(canvasWidth / 40));
    ctx.font = `bold ${size}px sans-serif`;
    ctx.textBaseline = "top";
    // outline for contrast
    ctx.lineWidth = Math.max(2, size / 8);
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(s.text, s.x, s.y);
    ctx.fillStyle = s.color;
    ctx.fillText(s.text, s.x, s.y);
  }
}

function drawStamp(ctx: CanvasRenderingContext2D, text: string, w: number, h: number) {
  const size = Math.max(12, Math.round(w / 60));
  ctx.font = `${size}px sans-serif`;
  const padding = size * 0.6;
  const barH = size + padding * 2;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, h - barH, w, barH);
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, padding, h - barH / 2);
}
