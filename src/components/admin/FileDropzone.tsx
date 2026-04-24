"use client";

/**
 * Single-file dropzone (currently only used for the GLB model).
 * Pure-preview — nothing touches Storage until the form Save /
 * Publish button fires.
 *
 * Mechanics:
 *   - User picks / drops a file → we stash it in component state and
 *     render filename + size + a Clear button. No network IO.
 *   - On mount we register with <StagedUploadsProvider> (from
 *     ProductForm). When the form submits, the provider invokes our
 *     `run()` which:
 *       1. Mints a signed PUT URL (`getSignedUploadUrl("glb", …)`).
 *       2. PUTs the .glb bytes directly to Supabase Storage. This
 *          step bypasses Vercel's 4.5 MB platform body cap — the
 *          whole reason for the direct-upload refactor.
 *       3. Returns hidden fields (`glb_path`, `glb_size_kb`) that
 *          ProductForm appends to its FormData before calling the
 *          server action.
 *   - On /products/new there's no productId yet, so the dropzone
 *     disables itself with a hint to save the name first. That
 *     keeps us from minting a signed URL for a UUID that doesn't
 *     exist in the products table yet.
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
  /** Comma-sep MIME types (forwarded to input.accept). */
  accept: string;
  /** Hard cap in MB. Mirrored by the storage bucket's file_size_limit. */
  maxFileMb: number;
  /** Pre-existing file URL to show as "current" preview. Optional. */
  currentUrl?: string | null;
  /** When set, render currentUrl as <img>; otherwise as a link. */
  currentIsImage?: boolean;
  /** Optional human-readable size of the current file ("1234 KB"). */
  currentMeta?: string | null;
  /** Visible label inside the dropzone when no file is selected. */
  hint?: string;
  /** Product id — required for the signed-URL mint path. When null
   *  (e.g. on /products/new before first save) the dropzone shows a
   *  gentle disabled hint. */
  productId?: string | null;
  /** Only "glb" is supported today. Kept explicit so a future
   *  thumbnail dropzone is a one-line change. */
  kind?: "glb";
};

export default function FileDropzone({
  accept,
  maxFileMb,
  currentUrl,
  currentIsImage,
  currentMeta,
  hint,
  productId,
  kind = "glb",
}: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const maxBytes = maxFileMb * 1024 * 1024;

  const { busy } = useStagedUploads();
  const disabled = !productId || busy;

  // The staged uploader reads the *latest* picked file via a ref so
  // the registration itself can be mount-once.
  const pickedRef = useLatestRef(picked);

  useRegisterStagedUploader("glb_file", {
    label: "3D model",
    pendingCount: () => (pickedRef.current ? 1 : 0),
    run: async (onProgress) => {
      const file = pickedRef.current;
      if (!file || !productId) return [];
      onProgress({
        label: `3D model (${file.name})`,
        done: 0,
        total: 1,
      });
      const r = await getSignedUploadUrl(kind, productId, file.name, file.type);
      if (!r.ok) {
        throw new Error(r.error);
      }
      await putBytes(r.ticket.signedUrl, file);
      onProgress({
        label: `3D model (${file.name})`,
        done: 1,
        total: 1,
      });
      const sizeKb = Math.round(file.size / 1024);
      const fields: StagedField[] = [
        { name: "glb_path", value: r.ticket.path },
        { name: "glb_size_kb", value: String(sizeKb) },
      ];
      return fields;
    },
  });

  function vet(f: File): string | null {
    if (accept) {
      const allowed = accept.split(",").map((m) => m.trim());
      // .glb often has empty / octet-stream type — accept by extension.
      const extOk = accept.includes(".glb") && /\.glb$/i.test(f.name);
      if (!extOk && f.type && !allowed.includes(f.type)) {
        return `${f.name}: unsupported format (${f.type || "unknown"})`;
      }
    }
    if (f.size > maxBytes) {
      const mb = (f.size / 1024 / 1024).toFixed(1);
      return `${f.name}: ${mb} MB exceeds ${maxFileMb} MB limit — please compress first`;
    }
    return null;
  }

  function take(f: File) {
    const vetErr = vet(f);
    if (vetErr) {
      setError(vetErr);
      return;
    }
    if (!productId) {
      setError(
        "Save the product first (just the name is enough) — then attach the .glb on the edit page.",
      );
      return;
    }
    setError(null);
    setPicked(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f) take(f);
  }

  function onClear(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    setPicked(null);
    setError(null);
  }

  // Clear the error banner automatically when the user picks a new
  // valid file (handled in take()), but also clear it if the product
  // id shows up post-redirect — otherwise a new-product flow shows
  // the stale "save first" hint forever.
  useEffect(() => {
    if (productId && error?.startsWith("Save the product first")) {
      setError(null);
    }
  }, [productId, error]);

  return (
    <div className="flex flex-col gap-2">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onClick={() => {
          if (disabled) return;
          pickerRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !disabled) {
            e.preventDefault();
            pickerRef.current?.click();
          }
        }}
        className={`relative flex min-h-[100px] flex-col items-center justify-center rounded-md border-2 border-dashed p-4 text-center text-sm transition ${
          disabled
            ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400"
            : dragging
              ? "cursor-pointer border-black bg-neutral-100"
              : "cursor-pointer border-neutral-300 bg-neutral-50 hover:border-neutral-500"
        }`}
      >
        <input
          ref={pickerRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) take(f);
            e.currentTarget.value = "";
          }}
        />
        {!productId ? (
          <div className="text-xs">
            Save the product first (just the name works), then drop a{" "}
            .glb here on the edit page.
          </div>
        ) : picked ? (
          <>
            <div className="font-medium text-neutral-800">{picked.name}</div>
            <div className="mt-1 text-xs text-neutral-500">
              {(picked.size / 1024).toFixed(0)} KB · staged — uploads on Save
            </div>
            {!busy && (
              <button
                type="button"
                onClick={onClear}
                className="mt-2 text-xs text-neutral-500 underline hover:text-rose-600"
              >
                Clear
              </button>
            )}
          </>
        ) : (
          <>
            <div className="text-neutral-700">
              {hint ?? "Click to pick a file, or drop it here"}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Max {maxFileMb} MB · staged for Save (no platform size limit)
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {currentUrl && !picked && (
        <div className="flex items-center gap-3 text-xs text-neutral-500">
          <span className="text-neutral-400">Current:</span>
          {currentIsImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt=""
              className="h-12 w-12 rounded border border-neutral-200 object-cover"
            />
          ) : (
            <a
              href={currentUrl}
              target="_blank"
              rel="noopener"
              className="text-sky-600 hover:underline"
            >
              {currentUrl.split("/").slice(-2).join("/")}
            </a>
          )}
          {currentMeta && <span>· {currentMeta}</span>}
        </div>
      )}
    </div>
  );
}

/**
 * PUT bytes directly to the signed URL. Identical to the image
 * dropzone's helper but kept local — both files are terse enough
 * that de-duping would cost more in imports than the 12 lines save.
 */
async function putBytes(signedUrl: string, file: File): Promise<void> {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "model/gltf-binary",
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
