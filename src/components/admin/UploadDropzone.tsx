"use client";

/**
 * Facebook-style image picker: drop or click to pick, see thumbnail
 * previews BEFORE anything is uploaded, remove individual files with
 * the × on each preview, then the main form's Submit is what
 * actually uploads.
 *
 * Why preview-before-commit: the old version just said "3 files
 * selected" and then the submit uploaded them. If the operator
 * accidentally selected a screenshot or the wrong batch, they'd
 * only notice post-upload — meaning a round-trip to delete bad
 * images. With previews they see exactly what will be sent,
 * and × lets them drop a single bad file without clearing the
 * whole batch.
 *
 * The dropzone still lives inside a server-action <form>, so the
 * underlying hidden <input type="file" multiple> is the real
 * source of truth — we sync user-dropped File objects into its
 * `.files` via DataTransfer so FormData picks them up verbatim
 * on submit. Thumbnails render from `URL.createObjectURL(file)`
 * and are revoked on unmount / clear.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";

type Props = {
  /** name attribute on the hidden file input — must match what the
   *  server action reads from FormData (currently "files"). */
  name: string;
  /** comma-sep MIME types allowed (forwarded to the input.accept). */
  accept: string;
  /** Whether the input should be `multiple`. */
  multiple?: boolean;
  /** Max per-file size in MB. Anything bigger is rejected client-side
   *  with a clear message instead of being thrown at the server,
   *  where it'd hit Next.js bodySizeLimit / Vercel's platform limit
   *  and bounce back as the generic "server error" page. */
  maxFileMb?: number;
};

const PROVIDER_HINT = "JPG / PNG / WebP supported";

type Preview = {
  file: File;
  // Object URL for <img src=…>. Revoked on clear / unmount — not
  // revoking leaks browser memory for every file the admin rejects.
  objectUrl: string;
};

export function UploadDropzone({
  name,
  accept,
  multiple = true,
  maxFileMb = 8,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const maxBytes = maxFileMb * 1024 * 1024;

  // Revoke every object URL we created when the component unmounts.
  // We also revoke per-preview in the remove/clear paths below.
  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Filter incoming files by MIME + size. Returns the survivors and
   *  collects per-file rejection messages for display. */
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

  function syncToInput(next: Preview[]) {
    if (!inputRef.current) return;
    // DataTransfer is the only cross-browser way to programmatically
    // populate <input type="file">.files. Without this, the dropped
    // files never reach FormData on submit.
    const dt = new DataTransfer();
    for (const p of next) dt.items.add(p.file);
    inputRef.current.files = dt.files;
    setPreviews(next);
  }

  function appendFiles(ok: File[]) {
    const added: Preview[] = ok.map((f) => ({
      file: f,
      objectUrl: URL.createObjectURL(f),
    }));
    const next = multiple ? [...previews, ...added] : added.slice(0, 1);
    // If single-select, revoke any previous preview we're about to
    // replace.
    if (!multiple) {
      for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    }
    syncToInput(next);
  }

  function removeAt(idx: number) {
    const removed = previews[idx];
    if (removed) URL.revokeObjectURL(removed.objectUrl);
    const next = previews.filter((_, i) => i !== idx);
    syncToInput(next);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const { ok, errors: errs } = vet(Array.from(e.dataTransfer.files));
    setErrors(errs);
    if (ok.length === 0) return;
    appendFiles(ok);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    // Only flip off if we're truly leaving the zone (not entering a child).
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }

  function handleClick() {
    inputRef.current?.click();
  }

  function handleClearAll(e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger the zone's onClick → file picker
    for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    syncToInput([]);
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
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClick();
          }
        }}
        className={`relative flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-center text-sm transition ${
          isDragging
            ? "border-black bg-neutral-100"
            : "border-neutral-300 bg-neutral-50 hover:border-neutral-500"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          // Using `hidden` is fine — required validation runs on submit
          // and reads the .files property regardless of visibility.
          hidden
          onChange={(e) => {
            const { ok, errors: errs } = vet(
              Array.from(e.currentTarget.files ?? []),
            );
            setErrors(errs);
            if (ok.length > 0) appendFiles(ok);
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
          {PROVIDER_HINT} · each ≤ {maxFileMb} MB
          {multiple ? " · multi-select · nothing uploads until you click the main Submit" : ""}
        </div>
      </div>

      {previews.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-white p-3">
          <div className="flex items-baseline justify-between">
            <div className="text-xs font-medium text-neutral-800">
              {previews.length} file{previews.length === 1 ? "" : "s"} ready
              to upload
            </div>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs text-neutral-500 underline hover:text-rose-600"
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
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white opacity-0 transition group-hover:opacity-100 hover:bg-black"
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
          <div className="mb-1 font-medium">Skipped files:</div>
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
