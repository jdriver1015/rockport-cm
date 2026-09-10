/**
 * Shrink a camera photo in the browser before it is uploaded.
 *
 * This is the single highest-leverage thing in the whole walk flow. A modern
 * phone shoots 12MP JPEGs at 4–8MB; at 1600px on the longest edge the same
 * picture is 300–500KB and still far more detail than anyone needs to see that
 * a sealant bead is missing. Ten photos on a walk goes from ~60MB to ~4MB,
 * which is the difference between a walk that finishes on site LTE and one that
 * sits spinning.
 *
 * Everything here is best-effort: if the browser cannot decode the image, or
 * the canvas refuses, the original File is returned. Losing a photo to a
 * resize failure would be far worse than uploading a big one.
 */

/** Longest edge, in CSS pixels, of the uploaded image. */
const MAX_EDGE = 1600;
/** JPEG quality. 0.8 is where artefacts stop being visible on a defect photo. */
const QUALITY = 0.8;
/** Below this, resizing costs more than it saves. */
const SKIP_UNDER_BYTES = 600_000;

export type DownscaleResult = {
  /** What to upload — the resized blob, or the original file if it was left alone. */
  blob: Blob;
  /** Filename to send. Always .jpg when we re-encoded. */
  fileName: string;
  /** True when the image actually went through the canvas. */
  resized: boolean;
  originalBytes: number;
  bytes: number;
};

function jpegName(name: string): string {
  const stem = name.replace(/\.[^./\\]+$/, "");
  return `${stem || "photo"}.jpg`;
}

export async function downscaleImage(file: File): Promise<DownscaleResult> {
  const untouched: DownscaleResult = {
    blob: file,
    fileName: file.name,
    resized: false,
    originalBytes: file.size,
    bytes: file.size,
  };

  // A small file, or something we should not re-encode. HEIC is decoded by the
  // browser where supported and falls through to the catch where it is not.
  if (file.size < SKIP_UNDER_BYTES) return untouched;
  if (typeof createImageBitmap !== "function") return untouched;

  try {
    // `from-image` applies the EXIF orientation while decoding. Without it a
    // photo shot in portrait arrives on its side, because the canvas draws raw
    // pixels and drops the orientation tag along with the rest of the EXIF.
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const longest = Math.max(bitmap.width, bitmap.height);

    if (longest <= MAX_EDGE) {
      bitmap.close();
      return untouched;
    }

    const scale = MAX_EDGE / longest;
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return untouched;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALITY),
    );
    // Only worth it if it actually got smaller — a already-compressed image can
    // come out of a re-encode larger than it went in.
    if (!blob || blob.size >= file.size) return untouched;

    return {
      blob,
      fileName: jpegName(file.name),
      resized: true,
      originalBytes: file.size,
      bytes: blob.size,
    };
  } catch {
    return untouched;
  }
}
