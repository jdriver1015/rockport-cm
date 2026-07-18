"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CameraIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AuditPhotoAnnotator } from "@/components/audit-photo-annotator";
import { deletePhoto, movePhoto, restorePhoto, updatePhotoCaption } from "@/lib/actions/audits";

export type PhotoRow = {
  id: number;
  caption: string | null;
  hasAnnotation: boolean;
  /** Pre-formatted GPS/timestamp line burned into the annotated render */
  stamp: string | null;
};

/** Ask the browser for a coarse location once; resolve null if denied/slow. */
function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { timeout: 5000, maximumAge: 60000 },
    );
  });
}

export function AuditPhotoGallery({
  propertyId,
  auditId,
  findingId,
  photos,
  readOnly,
}: {
  propertyId: number;
  auditId: number;
  findingId: number;
  photos: PhotoRow[];
  readOnly?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<PhotoRow | null>(null);

  function photoUrl(p: PhotoRow) {
    const base = `/api/properties/${propertyId}/audits/${auditId}/photos/${p.id}`;
    return p.hasAnnotation ? `${base}?v=annotated` : base;
  }

  async function handleFiles(files: FileList) {
    setBusy(true);
    try {
      const pos = await getPosition();
      const takenAt = new Date().toISOString();
      const fileArray = Array.from(files);
      let successCount = 0;
      for (const file of fileArray) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("findingId", String(findingId));
        fd.append("takenAt", takenAt);
        if (pos) {
          fd.append("gpsLat", pos.coords.latitude.toFixed(6));
          fd.append("gpsLng", pos.coords.longitude.toFixed(6));
        }
        const res = await fetch(`/api/properties/${propertyId}/audits/${auditId}/photos`, {
          method: "POST",
          body: fd,
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error ?? "Upload failed");
          break;
        }
        successCount++;
      }
      if (successCount > 0) {
        toast.success(`${successCount} photo${successCount === 1 ? "" : "s"} uploaded`);
        await router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      {photos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setViewer(p)}
              className="group relative h-24 w-24 overflow-hidden rounded-md border bg-muted"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photoUrl(p)}
                alt={p.caption ?? "Audit photo"}
                className="h-full w-full object-cover"
              />
              {p.caption && (
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 py-0.5 text-[10px] text-white">
                  {p.caption}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="mt-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            <CameraIcon className="mr-1 size-4" />
            {busy ? "Uploading…" : "Add photos"}
          </Button>
        </div>
      )}

      {viewer && (
        <PhotoViewer
          propertyId={propertyId}
          auditId={auditId}
          photo={viewer}
          url={photoUrl(viewer)}
          photos={photos}
          readOnly={readOnly}
          onClose={() => setViewer(null)}
        />
      )}
    </div>
  );
}

function PhotoViewer({
  propertyId,
  auditId,
  photo,
  url,
  photos,
  readOnly,
  onClose,
}: {
  propertyId: number;
  auditId: number;
  photo: PhotoRow;
  url: string;
  photos: PhotoRow[];
  readOnly?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [caption, setCaption] = useState(photo.caption ?? "");
  const [annotating, setAnnotating] = useState(false);
  const idx = photos.findIndex((p) => p.id === photo.id);

  function saveCaption() {
    startTransition(async () => {
      const res = await updatePhotoCaption({ id: photo.id, propertyId, auditId, caption });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Note saved");
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>Photo {idx >= 0 ? idx + 1 : ""}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={caption || "Audit photo"} className="mx-auto max-h-[55vh] w-auto" />
        </div>
        {!readOnly && (
          <div className="space-y-2">
            <Textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a note for this photo…"
              rows={2}
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={pending || idx <= 0}
                  onClick={() =>
                    startTransition(async () => {
                      await movePhoto({ id: photo.id, propertyId, auditId, direction: "up" });
                      router.refresh();
                    })
                  }
                  aria-label="Move earlier"
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={pending || idx === photos.length - 1}
                  onClick={() =>
                    startTransition(async () => {
                      await movePhoto({ id: photo.id, propertyId, auditId, direction: "down" });
                      router.refresh();
                    })
                  }
                  aria-label="Move later"
                >
                  <ChevronRightIcon className="size-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const res = await deletePhoto({ id: photo.id, propertyId, auditId });
                      if (!res.ok) {
                        toast.error(res.error);
                        return;
                      }
                      toast.success("Photo deleted", {
                        action: {
                          label: "Undo",
                          onClick: () =>
                            startTransition(async () => {
                              await restorePhoto({ id: photo.id, propertyId, auditId });
                              router.refresh();
                            }),
                        },
                      });
                      onClose();
                      router.refresh();
                    })
                  }
                >
                  Delete
                </Button>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAnnotating(true)}>
                  {photo.hasAnnotation ? "Re-annotate" : "Annotate"}
                </Button>
                <Button size="sm" disabled={pending} onClick={saveCaption}>
                  Save note
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
      {annotating && (
        <AuditPhotoAnnotator
          propertyId={propertyId}
          auditId={auditId}
          photoId={photo.id}
          stamp={photo.stamp}
          onClose={() => {
            setAnnotating(false);
            onClose();
          }}
        />
      )}
    </Dialog>
  );
}
