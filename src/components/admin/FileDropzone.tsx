"use client";

/**
 * Single-file drop-or-click input with client-direct-upload.
 *
 * Before 2026-04 this was a dumb proxy: pick a file, populate a
 * hidden <input type="file" form="product-form">, let the main Save
 * action's FormData carry the bytes up. For a 47 MB GLB that
 * approach hits Vercel Hobby's 4.5 MB platform body cap and the
 * Save click just dies (operator sees "This page couldn't load" —
 * no server log, because the platform rejects before Next ever runs).
 *
 * New design: the moment the user picks a file, we:
 *   1. Mint a signed PUT URL via `getSignedUploadUrl("glb", productId)`.
 *   2. PUT the bytes straight to Supabase Storage (bypasses Vercel).
 *   3. Write the returned storage path into a hidden
 *      `<input name="glb_path">` associated with the product form.
 *      Also write the size into `<input name="glb_size_kb">`.
 *   4. When the operator clicks Save, the main server action reads
 *      the small string fields — no file bytes ever enter FormData.
 *
 * For /products/new we don't have a productId yet → the form
 * disables the dropzone until save produces one (createProduct
 * returns a fresh id and redirects to /edit?fresh=1). That's fine
 * in practice: operator flow has always been "create draft with
 * name, then attach GLB + images on the edit page".
 */

import { useRef, useState, type DragEvent } from "react";
import { getSignedUploadUrl } from "@/app/admin/(dashboard)/products/upload-actions";

type Props = {
  /** Hidden input name on the PATH field — what the server action
   *  reads to learn where the bytes live. Conventionally "glb_path". */
  name: string;
  /** Comma-sep MIME types (forwarded to input.accept). */
  accept: string;
  /** Hard cap in MB. Mirrored by the storage bucket's file_size_limit. */
  maxFileMb: number;
  /** Form id to associate hidden inputs with — required because the
   *  dropzone lives outside the main <form> in ProductForm. */
  form?: string;
  /** Pre-existing file URL to show as "current" preview. Optional. */
  currentUrl?: string | null;
  /** When set, render currentUrl as <img>; otherwise as a link. */
  currentIsImage?: boolean;
  /** Optional human-readable size of the current file ("1234 KB"). */
  currentMeta?: string | null;
  /** Visible label inside the dropzone when no file is selected. */
  hint?: string;
  /** Product id — required. When null (e.g. on /products/new before
   *  first save) the dropzone disables itself with a gentle hint. */
  productId?: string | null;
  /** Only "glb" is supported today. Kept explicit so a future model /
   *  thumbnail reuse is one-line. */
  kind?: "glb";
};

type Phase = "idle" | "uploading" | "done" | "error";

export default function FileDropzone({
  name,
  accept,
  maxFileMb,
  form,
  currentUrl,
  currentIsImage,
  currentMeta,
  hint,
  productId,
  kind = "glb",
}: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<File | null>(null);
  /** Storage path returned after a successful direct upload. This is
   *  what actually ships to the product save action via the hidden
   *  `name` input. */
  const [uploadedPath, setUploadedPath] = useState<string | null>(null);

  const busy = phase === "uploading";
  const disabled = !productId;
  const maxBytes = maxFileMb * 1024 * 1024;

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

  async function take(f: File) {
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
    setPhase("uploading");
    try {
      const r = await getSignedUploadUrl(kind, productId, f.name, f.type);
      if (!r.ok) {
        throw new Error(r.error);
      }
      await putBytes(r.ticket.signedUrl, f);
      setUploadedPath(r.ticket.path);
      setPhase("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setPhase("error");
      setUploadedPath(null);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (busy || disabled) return;
    const f = e.dataTransfer.files[0];
    if (f) void take(f);
  }

  function onClear(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    setPicked(null);
    setUploadedPath(null);
    setPhase("idle");
    setError(null);
  }

  const sizeKb = picked ? Math.round(picked.size / 1024) : null;

  return (
    <div className="flex flex-col gap-2">
      {/* Hidden inputs carried in the main product form. These are
          the ONLY things that make it to the server action. */}
      {uploadedPath && (
        <>
          <input type="hidden" form={form} name={name} value={uploadedPath} />
          {sizeKb != null && (
            <input
              type="hidden"
              form={form}
              name={`${name.replace(/_path$/, "")}_size_kb`}
              value={sizeKb}
            />
          )}
        </>
      )}

      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy && !disabled && !dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onClick={() => {
          if (busy || disabled) return;
          pickerRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-disabled={busy || disabled}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy && !disabled) {
            e.preventDefault();
            pickerRef.current?.click();
          }
        }}
        className={`relative flex min-h-[100px] flex-col items-center justify-center rounded-md border-2 border-dashed p-4 text-center text-sm transition ${
          disabled
            ? "cursor-not-allowed border-neutral-200 bg-neutral-50 text-neutral-400"
            : busy
              ? "cursor-wait border-neutral-300 bg-neutral-50 opacity-70"
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
            if (f) void take(f);
            e.currentTarget.value = "";
          }}
        />
        {disabled ? (
          <div className="text-xs">
            Save the product first (just the name works), then drop a{" "}
            .glb here on the edit page.
          </div>
        ) : picked ? (
          <>
            <div className="font-medium text-neutral-800">{picked.name}</div>
            <div className="mt-1 text-xs text-neutral-500">
              {(picked.size / 1024).toFixed(0)} KB ·{" "}
              {phase === "uploading"
                ? "uploading direct to Storage…"
                : phase === "done"
                  ? "uploaded — click Save to apply"
                  : phase === "error"
                    ? "upload failed"
                    : "ready"}
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
              Max {maxFileMb} MB · uploads direct to Storage (no platform
              size limit)
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
