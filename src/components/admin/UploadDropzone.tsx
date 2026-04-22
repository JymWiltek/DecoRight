"use client";

/**
 * Drag-and-drop dropzone wrapping a hidden <input type="file" multiple>.
 * Lives inside a server-action <form>, so the underlying input is the
 * actual source of truth — we just sync user-dropped File objects into
 * its `.files` via DataTransfer so FormData picks them up unchanged on
 * submit. Click anywhere on the zone to open the OS file picker.
 *
 * The submit button + "全部抠图" affordance stay rendered by the parent
 * server component; this file only owns the file-selection UX.
 */
import { useRef, useState, type DragEvent } from "react";

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

const PROVIDER_HINT = "支持 JPG / PNG / WebP";

export function UploadDropzone({
  name,
  accept,
  multiple = true,
  maxFileMb = 8,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  const maxBytes = maxFileMb * 1024 * 1024;

  /** Filter incoming files by MIME + size. Returns the survivors and
   *  collects per-file rejection messages for display. */
  function vet(incoming: File[]): { ok: File[]; errors: string[] } {
    const ok: File[] = [];
    const errs: string[] = [];
    const allowed = accept.split(",").map((m) => m.trim());
    for (const f of incoming) {
      if (allowed.length && !allowed.includes(f.type)) {
        errs.push(`${f.name}：不支持的格式 (${f.type || "unknown"})`);
        continue;
      }
      if (f.size > maxBytes) {
        const mb = (f.size / 1024 / 1024).toFixed(1);
        errs.push(`${f.name}：${mb} MB 超过 ${maxFileMb} MB 上限，请先压缩`);
        continue;
      }
      ok.push(f);
    }
    return { ok, errors: errs };
  }

  function syncFilesToInput(next: File[]) {
    if (!inputRef.current) return;
    // DataTransfer is the only cross-browser way to programmatically
    // populate <input type="file">.files. Without this, the dropped
    // files never reach FormData on submit.
    const dt = new DataTransfer();
    for (const f of next) dt.items.add(f);
    inputRef.current.files = dt.files;
    setFiles(next);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    const { ok, errors: errs } = vet(Array.from(e.dataTransfer.files));
    setErrors(errs);
    if (ok.length === 0) return;
    syncFilesToInput(multiple ? [...files, ...ok] : ok.slice(0, 1));
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

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation(); // don't trigger the zone's onClick → file picker
    syncFilesToInput([]);
  }

  return (
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
          syncFilesToInput(multiple ? ok : ok.slice(0, 1));
        }}
      />
      {files.length === 0 ? (
        <>
          <div className="text-neutral-700">
            点击选文件，或把图片拖到这里
          </div>
          <div className="mt-1 text-xs text-neutral-500">
            {PROVIDER_HINT} · 单张 ≤ {maxFileMb} MB
            {multiple ? " · 可多选" : ""}
          </div>
        </>
      ) : (
        <>
          <div className="font-medium text-neutral-800">
            已选 {files.length} 张
          </div>
          <div className="mt-1 max-w-full truncate text-xs text-neutral-500">
            {files.map((f) => f.name).join("、")}
          </div>
          <button
            type="button"
            onClick={handleClear}
            className="mt-2 text-xs text-neutral-500 underline hover:text-rose-600"
          >
            清空
          </button>
        </>
      )}
      {errors.length > 0 && (
        <div className="mt-3 w-full rounded-md bg-rose-50 px-3 py-2 text-left text-xs text-rose-700">
          <div className="mb-1 font-medium">以下文件被跳过：</div>
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
