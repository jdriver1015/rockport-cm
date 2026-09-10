"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CameraIcon, ImagePlusIcon, RotateCwIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downscaleImage } from "@/lib/photo-downscale";

export type WalkPhoto = {
  id: number;
  caption: string | null;
  hasAnnotation: boolean;
  version: string;
  /** Set once the photo has been promoted to a finding. */
  findingId: number | null;
};

type QueueItem = {
  key: string;
  previewUrl: string;
  status: "waiting" | "uploading" | "failed";
  attempts: number;
  file: File;
  error?: string;
};

const MAX_ATTEMPTS = 3;

/** Where the walk was, if the phone will say. Never blocks the upload. */
function currentPosition(): Promise<GeolocationPosition | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 4000, maximumAge: 60_000 },
    );
  });
}

/**
 * The walk's photo reel, and the camera.
 *
 * Shoot first, classify later: these photos belong to the walk and carry no
 * finding until somebody decides one of them is a defect. That is the whole
 * point of the model change underneath — a superintendent should not have to
 * write up an issue before the camera will open.
 *
 * Uploads go through a queue rather than an await in a loop. On site the
 * network is the slow part, and the old flow blocked the UI on it and abandoned
 * the whole batch on the first failure. Here the shot is captured instantly,
 * the queue drains behind it with retries, and a photo that fails can be
 * retried by itself without losing the rest.
 *
 * Serial on purpose. sort_index is assigned server-side per upload, so
 * uploading in order is what keeps the reel in the order it was shot.
 */
export function WalkPhotoCapture({
  propertyId,
  auditId,
  photos,
  canEdit,
}: {
  propertyId: number;
  auditId: number;
  photos: WalkPhoto[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const draining = useRef(false);

  /**
   * The ref is authoritative and `queue` state is a mirror of it for
   * rendering — not the other way round.
   *
   * The pump runs across awaits and has to see writes made while it is
   * suspended. Mirroring state into a ref instead would mean writing the ref
   * during render (which React forbids, since a discarded render would still
   * have mutated it) or syncing in an effect, which races the pump: drain can
   * start, read a ref the effect has not updated yet, find nothing waiting and
   * stop with photos still queued.
   */
  const queueRef = useRef<QueueItem[]>([]);
  const commit = useCallback((next: (current: QueueItem[]) => QueueItem[]) => {
    queueRef.current = next(queueRef.current);
    setQueue(queueRef.current);
  }, []);

  // Object URLs are leaked memory until revoked, and a walk can run to dozens
  // of photos. Revoked when the item leaves the queue, and on unmount.
  useEffect(() => {
    return () => {
      for (const item of queueRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, []);

  const uploadOne = useCallback(
    async (item: QueueItem): Promise<boolean> => {
      const [{ blob, fileName }, pos] = await Promise.all([
        downscaleImage(item.file),
        currentPosition(),
      ]);
      const fd = new FormData();
      fd.append("file", new File([blob], fileName, { type: blob.type || "image/jpeg" }));
      fd.append("takenAt", new Date().toISOString());
      if (pos) {
        fd.append("gpsLat", pos.coords.latitude.toFixed(6));
        fd.append("gpsLng", pos.coords.longitude.toFixed(6));
      }
      const res = await fetch(`/api/properties/${propertyId}/audits/${auditId}/photos`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Upload failed (${res.status})`);
      }
      return true;
    },
    [propertyId, auditId],
  );

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      // Re-read from the ref each pass: the queue changes while this runs.
      for (;;) {
        const next = queueRef.current.find((i) => i.status === "waiting");
        if (!next) break;
        commit((q) =>
          q.map((i) => (i.key === next.key ? { ...i, status: "uploading" as const } : i)),
        );
        try {
          await uploadOne(next);
          URL.revokeObjectURL(next.previewUrl);
          commit((q) => q.filter((i) => i.key !== next.key));
          router.refresh();
        } catch (err) {
          const attempts = next.attempts + 1;
          const message = err instanceof Error ? err.message : "Upload failed";
          if (attempts < MAX_ATTEMPTS) {
            // Back off a little and leave it waiting — a flaky moment on site
            // should not cost the shot.
            await new Promise((r) => setTimeout(r, 800 * attempts));
            commit((q) =>
              q.map((i) =>
                i.key === next.key ? { ...i, status: "waiting" as const, attempts } : i,
              ),
            );
          } else {
            commit((q) =>
              q.map((i) =>
                i.key === next.key
                  ? { ...i, status: "failed" as const, attempts, error: message }
                  : i,
              ),
            );
            toast.error(message);
          }
        }
      }
    } finally {
      draining.current = false;
    }
  }, [uploadOne, router, commit]);

  function enqueue(files: FileList | null) {
    if (!files || files.length === 0) return;
    const items: QueueItem[] = Array.from(files).map((file) => ({
      key: crypto.randomUUID(),
      previewUrl: URL.createObjectURL(file),
      status: "waiting",
      attempts: 0,
      file,
    }));
    commit((q) => [...q, ...items]);
    void drain();
  }

  function retry(key: string) {
    commit((q) =>
      q.map((i) => (i.key === key ? { ...i, status: "waiting" as const, attempts: 0 } : i)),
    );
    void drain();
  }

  function discard(key: string) {
    commit((q) => {
      const item = q.find((i) => i.key === key);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return q.filter((i) => i.key !== key);
    });
  }

  const pending = queue.filter((i) => i.status !== "failed").length;

  return (
    <div className="space-y-3">
      {canEdit && (
        <>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            // Opens the camera straight to the viewfinder on a phone rather
            // than a file browser. Desktop ignores it and shows a file picker.
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              enqueue(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={() => cameraRef.current?.click()}
              // Tall: this is the control the whole screen exists for, and it
              // is pressed with a thumb, often in a glove.
              className="h-12 flex-1 text-[15px]"
            >
              <CameraIcon className="size-5" />
              Take photo
            </Button>
            <Button
              type="button"
              variant="outline"
              aria-label="Add from library"
              onClick={() => libraryRef.current?.click()}
              className="h-12 w-12 shrink-0"
            >
              <ImagePlusIcon className="size-5" />
            </Button>
          </div>
        </>
      )}

      {pending > 0 && (
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          Uploading {pending} photo{pending === 1 ? "" : "s"}…
        </p>
      )}

      {(photos.length > 0 || queue.length > 0) && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {/* In-flight shots first: the one just taken should appear where the
              eye already is, not after a round trip. */}
          {queue.map((item) => (
            <div
              key={item.key}
              className="relative aspect-square overflow-hidden rounded-card border border-border bg-track"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.previewUrl}
                alt=""
                className={cn(
                  "size-full object-cover transition-opacity",
                  item.status === "failed" ? "opacity-40" : "opacity-60",
                )}
              />
              {item.status === "failed" ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-alert-bg/80 p-1">
                  <button
                    type="button"
                    onClick={() => retry(item.key)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-alert"
                  >
                    <RotateCwIcon className="size-3.5" />
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => discard(item.key)}
                    className="flex items-center gap-1 text-[11px] text-ink-400"
                  >
                    <XIcon className="size-3" />
                    Discard
                  </button>
                </div>
              ) : (
                <div className="absolute inset-x-0 bottom-0 h-0.5 animate-pulse bg-navy" />
              )}
            </div>
          ))}

          {photos.map((p) => {
            const base = `/api/properties/${propertyId}/audits/${auditId}/photos/${p.id}`;
            const src = `${base}${p.hasAnnotation ? "?v=annotated&" : "?"}t=${encodeURIComponent(p.version)}`;
            return (
              <div
                key={p.id}
                className="relative aspect-square overflow-hidden rounded-card border border-border bg-track"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={p.caption ?? ""} className="size-full object-cover" />
                {p.findingId != null && (
                  <span
                    className="absolute top-1 right-1 rounded-control bg-alert px-1.5 py-0.5 text-[9px] font-bold tracking-[0.06em] text-white uppercase"
                    title="Attached to an issue"
                  >
                    Issue
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {photos.length === 0 && queue.length === 0 && (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No photos yet. Walk the site and shoot what you see — you can turn any of them into an
          issue afterwards.
        </p>
      )}
    </div>
  );
}
