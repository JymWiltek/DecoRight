"use client";

/**
 * Pure-preview image dropzone.
 *
 * Design (post "commit-on-Save" refactor):
 *   - Drop / pick files → instant thumbnail previews. Nothing touches
 *     Storage or the DB. The × removes a staged file; Clear nukes
 *     the whole batch. This mirrors Gmail draft semantics: it's not
 *     sent until you click Send.
 *   - The dropzone registers itself with <StagedUploadsProvider>
 *     (mounted by ProductForm). When the form's Save / Publish
 *     button fires, ProductForm iterates registered uploaders; our
 *     `run()` then:
 *        a. For each staged file, mint a signed PUT URL via
 *           `getSignedUploadUrl("raw_image", …)`.
 *        b. PUT bytes directly to Supabase Storage (no Vercel body cap).
 *        c. Return a `raw_image_entries` JSON blob that gets appended
 *           to the FormData the server action receives.
 *   - DB row insertion + optional rembg happen inside the server
 *     action (createProduct / updateProduct). That's the single
 *     commit point; if the user clicks Save-as-Draft, rembg never
 *     runs. If Publish or Save-on-published, the server action
 *     kicks rembg synchronously.
 *
 * No progress indicator *inside* the dropzone during submit — the
 * banner lives at the form level (SubmitPhaseBanner). This avoids
 * a confusing "which spinner is authoritative?" UX.
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { getSignedUploadUrl } from "@/app/admin/(dashboard)/products/upload-actions";
import {
  useLatestRef,
  useRegisterStagedUploader,
  useStagedUploads,
  type StagedField,
} from "./product-form-staging";

type Props = {
  productId: string;
  /** comma-sep MIME types allowed (forwarded to the input.accept). */
  accept?: string;
  /** Whether the input should be `multiple`. */
  multiple?: boolean;
  /** Max per-file size in MB. Client-side guard so a misclick on a
   *  200 MB raw .tiff bounces locally instead of burning the signed
   *  URL and getting rejected by the storage bucket. */
  maxFileMb?: number;
};

const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp";

type Preview = {
  file: File;
  // Object URL for <img src=…>. Revoked on clear / unmount.
  objectUrl: string;
};

export function UploadDropzone({
  productId,
  accept = DEFAULT_ACCEPT,
  multiple = true,
  maxFileMb = 8,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const maxBytes = maxFileMb * 1024 * 1024;
  const { busy } = useStagedUploads();
  const disabled = busy;

  // Parent's submit handler needs to read the *current* previews
  // list, but we only want to register the uploader once on mount
  // (otherwise the registration resubscribes on every state change).
  const previewsRef = useLatestRef(previews);

  // Clean up object URLs on unmount. Can't put this in the same
  // effect as appendFiles' creation because unmount cleanup runs
  // only once.
  useEffect(() => {
    return () => {
      for (const p of previewsRef.current) URL.revokeObjectURL(p.objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRegisterStagedUploader("raw_images", {
    label: "images",
    pendingCount: () => previewsRef.current.length,
    run: async (onProgress) => {
      const files = previewsRef.current;
      if (files.length === 0) return [];

      const entries: { imageId: string; ext: string }[] = [];
      const runtimeErrors: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const p = files[i];
        onProgress({
          label: `image ${i + 1}/${files.length} (${p.file.name})`,
          done: i,
          total: files.length,
        });
        try {
          const r = await getSignedUploadUrl(
            "raw_image",
            productId,
            p.file.name,
            p.file.type,
          );
          if (!r.ok || !r.ticket.imageId) {
            throw new Error(r.ok ? "missing image id" : r.error);
          }
          await putBytes(r.ticket.signedUrl, p.file);
          // Recover the extension from the minted path ("<product>/<id>.<ext>").
          const ext = r.ticket.path.split(".").pop() ?? "jpg";
          entries.push({ imageId: r.ticket.imageId, ext });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          runtimeErrors.push(`${p.file.name}: ${msg}`);
        }
      }
      onProgress({
        label: `${entries.length} image${entries.length === 1 ? "" : "s"} uploaded`,
        done: files.length,
        total: files.length,
      });

      // Surface runtime errors as a persistent banner below the
      // dropzone — but don't throw, we still want the server action
      // to proceed with the images that DID upload.
      if (runtimeErrors.length > 0) setErrors(runtimeErrors);

      if (entries.length === 0) return [];

      const result: StagedField[] = [
        { name: "raw_image_entries", value: JSON.stringify(entries) },
      ];
      return result;
    },
  });

  function vet(incoming: File[]): { ok: File[]; errors: string[] } {
    const ok: File[] = [];
    const errs: string[] = [];
    const allowed = accept.split(",").map((m) => m.trim());
    for (const f of incoming) {
      if (allowed.length && !allowed.includes(f.type)) {
        errs.push(`${f.name}: unsupported format (${f.type || "unknown"})`);
        continue;
      }
      if (f.size > maxBytes) {
        const mb = (f.size / 1024 / 1024).toFixed(1);
        errs.push(
          `${f.name}: ${mb} MB exceeds the ${maxFileMb} MB limit — please compress first`,
        );
        continue;
      }
      ok.push(f);
    }
    return { ok, errors: errs };
  }

  function appendFiles(ok: File[]) {
    const added: Preview[] = ok.map((f) => ({
      file: f,
      objectUrl: URL.createObjectURL(f),
    }));
    setPreviews((prev) => {
      if (!multiple) {
        for (const p of prev) URL.revokeObjectURL(p.objectUrl);
        return added.slice(0, 1);
      }
      return [...prev, ...added];
    });
  }

  function removeAt(idx: number) {
    if (disabled) return;
    setPreviews((prev) => {
      const removed = prev[idx];
      if (removed) URL.revokeObjectURL(removed.objectUrl);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const { ok, errors: errs } = vet(Array.from(e.dataTransfer.files));
    setErrors(errs);
    if (ok.length === 0) return;
    appendFiles(ok);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (disabled) return;
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }

  function handleClick() {
    if (disabled) return;
    inputRef.current?.click();
  }

  function handleClearAll(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    setPreviews((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.objectUrl);
      return [];
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            handleClick();
          }
        }}
        className={`relative flex min-h-[140px] flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-center text-sm transition ${
          disabled
            ? "cursor-not-allowed border-neutral-300 bg-neutral-50 opacity-60"
            : isDragging
              ? "cursor-pointer border-black bg-neutral-100"
              : "cursor-pointer border-neutral-300 bg-neutral-50 hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          onChange={(e) => {
            const { ok, errors: errs } = vet(
              Array.from(e.currentTarget.files ?? []),
            );
            setErrors(errs);
            if (ok.length > 0) appendFiles(ok);
            // Reset the native picker so picking the same file twice
            // still triggers onChange.
            e.currentTarget.value = "";
          }}
        />
        <div className="text-neutral-700">
          {previews.length === 0
            ? "Click to pick files, or drop images here"
            : multiple
              ? "Click or drop to add more"
              : "Click or drop to replace"}
        </div>
        <div className="mt-1 text-xs text-neutral-500">
          JPG / PNG / WebP · each ≤ {maxFileMb} MB
          {multiple ? " · multi-select" : ""}
        </div>
        <div className="mt-1 text-[11px] text-neutral-400">
          Nothing uploads until you click Save / Publish.
        </div>
      </div>

      {previews.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-medium text-neutral-800">
              {previews.length} file{previews.length === 1 ? "" : "s"} staged
              — upload on Save / Publish
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={disabled}
              className="text-xs text-neutral-500 underline hover:text-rose-600 disabled:opacity-50"
            >
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
            {previews.map((p, i) => (
              <div
                key={`${p.file.name}-${p.file.size}-${i}`}
                className="group relative aspect-square overflow-hidden rounded-md border border-neutral-200 bg-neutral-100"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.objectUrl}
                  alt={p.file.name}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeAt(i);
                  }}
                  disabled={disabled}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white opacity-0 transition group-hover:opacity-100 hover:bg-black disabled:opacity-0"
                  aria-label={`Remove ${p.file.name}`}
                  title="Remove"
                >
                  ×
                </button>
                <div
                  className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 text-[10px] text-white"
                  title={p.file.name}
                >
                  <div className="truncate">{p.file.name}</div>
                  <div className="opacity-70">
                    {(p.file.size / 1024).toFixed(0)} KB
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-left text-xs text-rose-700">
          <div className="mb-1 font-medium">Errors:</div>
          <ul className="list-disc space-y-0.5 pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * PUT bytes directly to the signed URL. We use plain fetch() instead
 * of supabase.storage.uploadToSignedUrl because fetch works identically
 * without pulling the supabase client into this module. The wire
 * format is identical — Storage accepts x-upsert + Content-Type
 * headers either way.
 */
async function putBytes(signedUrl: string, file: File): Promise<void> {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
      "cache-control": "max-age=31536000",
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `upload failed (${res.status}): ${text || res.statusText}`,
    );
  }
}
