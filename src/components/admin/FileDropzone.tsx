"use client";

/**
 * Single-file drop-or-click input. A trimmed sibling of UploadDropzone
 * (multi-file image bulk-upload), kept separate because:
 *
 *   - We always want exactly one file (GLB or thumbnail), so the
 *     "files selected" UI plural / clear flows are simpler here.
 *   - GLB max-size is 60 MB after migration 0011 — we surface the
 *     limit inline so a 70 MB upload bounces with a real message
 *     instead of hitting the platform body-size limit and
 *     returning a generic 500.
 *   - We render a richer "current file" preview (existing thumbnail
 *     image, current GLB filename) — the bulk image dropzone has a
 *     completely different "uploaded files list" UI.
 *
 * Lives inside ProductForm via the form="..." attribute on the hidden
 * <input>, so the file gets submitted with the main update action
 * even though the dropzone DOM sits outside that <form> for
 * nested-form-prevention reasons (see ProductForm header comment).
 */

import { useRef, useState, type DragEvent } from "react";

type Props = {
  /** Hidden input name; the server action reads this via fd.get(). */
  name: string;
  /** Comma-sep MIME types (forwarded to input.accept). Empty = any. */
  accept: string;
  /** Hard cap in MB. Anything bigger is rejected client-side with a
   *  visible error so the operator never wonders why a 70 MB GLB
   *  produced a generic 500. Mirrored on the server side via the
   *  storage bucket's file_size_limit. */
  maxFileMb: number;
  /** Form id to associate the hidden input with — required because
   *  the dropzone sits outside the main <form> in ProductForm. */
  form?: string;
  /** Pre-existing file URL to show as "current" preview. Optional. */
  currentUrl?: string | null;
  /** When set, render currentUrl as <img>; otherwise render filename
   *  with a clickable link. */
  currentIsImage?: boolean;
  /** Optional human-readable size of the current file ("1234 KB"). */
  currentMeta?: string | null;
  /** Visible label inside the dropzone when no file is selected. */
  hint?: string;
};

export default function FileDropzone({
  name,
  accept,
  maxFileMb,
  form,
  currentUrl,
  currentIsImage,
  currentMeta,
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [picked, setPicked] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxBytes = maxFileMb * 1024 * 1024;

  function vet(f: File): string | null {
    if (accept) {
      const allowed = accept.split(",").map((m) => m.trim());
      // .glb files often have empty / "application/octet-stream" type
      // in some browsers — accept by extension as a fallback.
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

  function syncToInput(f: File | null) {
    if (!inputRef.current) return;
    const dt = new DataTransfer();
    if (f) dt.items.add(f);
    inputRef.current.files = dt.files;
    setPicked(f);
  }

  function take(f: File) {
    const err = vet(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    syncToInput(f);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) take(f);
  }

  function onClear(e: React.MouseEvent) {
    e.stopPropagation();
    setError(null);
    syncToInput(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        className={`relative flex min-h-[100px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-4 text-center text-sm transition ${
          dragging
            ? "border-black bg-neutral-100"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          form={form}
          type="file"
          name={name}
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) take(f);
          }}
        />
        {picked ? (
          <>
            <div className="font-medium text-neutral-800">{picked.name}</div>
            <div className="mt-1 text-xs text-neutral-500">
              {(picked.size / 1024).toFixed(0)} KB · ready to upload
            </div>
            <button
              type="button"
              onClick={onClear}
              className="mt-2 text-xs text-neutral-500 underline hover:text-rose-600"
            >
              Clear
            </button>
          </>
        ) : (
          <>
            <div className="text-neutral-700">
              {hint ?? "Click to pick a file, or drop it here"}
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Max {maxFileMb} MB
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
