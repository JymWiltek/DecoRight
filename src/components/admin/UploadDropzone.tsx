"use client";

/**
 * Facebook-style image picker with client-direct-upload.
 *
 * Before the 2026-04 refactor this was a "populate the hidden file
 * input then let the outer <form action=uploadRawImages> submit" dumb
 * proxy. That path fell over on Vercel: a batch of phone photos or
 * a single high-res scan routinely exceeds Vercel Hobby's 4.5 MB
 * platform body cap, which kills the POST before Next.js can parse
 * it — the operator sees "This page couldn't load".
 *
 * New design:
 *   1. User picks / drops N files → instant thumbnail previews.
 *      Nothing uploads yet. × removes, Clear all nukes.
 *   2. Click Upload:
 *      a. For each file, call `getSignedUploadUrl("raw_image", ...)`
 *         to mint a signed PUT URL + pre-generate a product_image id.
 *      b. PUT the raw bytes directly to Supabase Storage (bypasses
 *         Vercel entirely — no platform body cap in the way).
 *      c. Once all uploads finish, call `attachRawImages` once to
 *         insert all the product_images rows (state=raw).
 *      d. Call `kickRembgPipeline` to run rembg AUTO on each row;
 *         successes land at cutout_approved (+ primary if first),
 *         failures land at cutout_failed.
 *   3. `router.refresh()` pulls the new rows into the surrounding
 *      ProductImagesSection.
 *
 * No <form> wrapper needed: every mutation is an explicit RPC and
 * the dropzone owns its lifecycle. Progress + error feedback live
 * entirely client-side.
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import {
  getSignedUploadUrl,
  attachRawImages,
  kickRembgPipeline,
  type AttachRawImageEntry,
} from "@/app/admin/(dashboard)/products/upload-actions";

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

type Phase = "idle" | "uploading" | "attaching" | "rembg" | "done" | "error";

type FailedImage = { imageId: string; code: string; msg: string };

export function UploadDropzone({
  productId,
  accept = DEFAULT_ACCEPT,
  multiple = true,
  maxFileMb = 8,
}: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });
  const [failures, setFailures] = useState<FailedImage[]>([]);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const maxBytes = maxFileMb * 1024 * 1024;
  const busy = phase !== "idle" && phase !== "done" && phase !== "error";

  useEffect(() => {
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const next = multiple ? [...previews, ...added] : added.slice(0, 1);
    if (!multiple) {
      for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    }
    setPreviews(next);
  }

  function removeAt(idx: number) {
    if (busy) return;
    const removed = previews[idx];
    if (removed) URL.revokeObjectURL(removed.objectUrl);
    setPreviews(previews.filter((_, i) => i !== idx));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setIsDragging(false);
    if (busy) return;
    const { ok, errors: errs } = vet(Array.from(e.dataTransfer.files));
    setErrors(errs);
    if (ok.length === 0) return;
    appendFiles(ok);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (busy) return;
    if (!isDragging) setIsDragging(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }

  function handleClick() {
    if (busy) return;
    inputRef.current?.click();
  }

  function handleClearAll(e: React.MouseEvent) {
    e.stopPropagation();
    if (busy) return;
    for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    setPreviews([]);
  }

  /**
   * PUT a single file to the signed URL. We use fetch() instead of
   * supabase.storage.uploadToSignedUrl because fetch works identically
   * in a Server Component-bundled module tree, whereas uploadToSignedUrl
   * would require importing the supabase client here (more code, same
   * wire protocol).
   */
  async function putBytes(signedUrl: string, file: File): Promise<void> {
    const res = await fetch(signedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "x-upsert": "true",
        // Cache the bytes hard at the CDN. The path is stable per image-id
        // and we'd never re-upload to the same path without intending
        // to replace — and the rembg output path is different anyway.
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

  async function handleUpload() {
    if (busy || previews.length === 0) return;
    setErrors([]);
    setFailures([]);
    setLastSummary(null);

    setPhase("uploading");
    setProgress({ done: 0, total: previews.length });

    const uploaded: AttachRawImageEntry[] = [];
    const ticketByFile: Array<{ file: File; imageId: string; ext: string }> =
      [];

    // Phase 1: mint ticket + PUT bytes, per file, sequentially. Parallel
    // would be faster but Storage rate-limits per-project and the UX
    // benefit for a 1–10 file batch is small.
    for (let i = 0; i < previews.length; i++) {
      const p = previews[i];
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
        uploaded.push({ imageId: r.ticket.imageId, ext });
        ticketByFile.push({ file: p.file, imageId: r.ticket.imageId, ext });
        setProgress({ done: i + 1, total: previews.length });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrors((prev) => [...prev, `${p.file.name}: ${msg}`]);
      }
    }

    if (uploaded.length === 0) {
      setPhase("error");
      return;
    }

    // Phase 2: attach rows.
    setPhase("attaching");
    const attachRes = await attachRawImages(productId, uploaded);
    if (!attachRes.ok) {
      setErrors((prev) => [...prev, `attach: ${attachRes.error}`]);
      setPhase("error");
      return;
    }

    // Phase 3: rembg AUTO per image.
    setPhase("rembg");
    setProgress({ done: 0, total: uploaded.length });
    const kickRes = await kickRembgPipeline(
      productId,
      uploaded.map((u) => u.imageId),
    );
    let approved = 0;
    const fails: FailedImage[] = [];
    for (const o of kickRes.outcomes) {
      if (o.ok) approved++;
      else fails.push({ imageId: o.imageId, code: o.code ?? "rembg", msg: o.msg ?? "" });
    }
    setFailures(fails);
    setProgress({ done: kickRes.outcomes.length, total: kickRes.outcomes.length });

    // Clear previews (they're now represented as cards below by the
    // refreshed ProductImagesSection).
    for (const p of previews) URL.revokeObjectURL(p.objectUrl);
    setPreviews([]);

    const summary =
      fails.length === 0
        ? `${approved} image${approved === 1 ? "" : "s"} uploaded and cutout-approved.`
        : `${approved} approved · ${fails.length} failed (retry on each card below).`;
    setLastSummary(summary);
    setPhase("done");

    // Pull the new rows into the surrounding server component.
    router.refresh();
  }

  // ── render ─────────────────────────────────────────────────

  const phaseLabel: Record<Phase, string> = {
    idle: "",
    uploading: `Uploading ${progress.done}/${progress.total}…`,
    attaching: "Saving…",
    rembg: `Removing background ${progress.done}/${progress.total}…`,
    done: lastSummary ?? "Done.",
    error: "Upload failed — see errors below.",
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        aria-disabled={busy}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            handleClick();
          }
        }}
        className={`relative flex min-h-[140px] flex-col items-center justify-center rounded-md border-2 border-dashed p-6 text-center text-sm transition ${
          busy
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
              disabled={busy}
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
                  disabled={busy}
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
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[11px] text-neutral-500">
              Uploads directly to Storage — no platform size limit.
              Background removal (~$0.001/img via Replicate) runs
              automatically.
            </div>
            <button
              type="button"
              onClick={handleUpload}
              disabled={busy}
              className="rounded-md bg-black px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
            >
              {busy ? "Uploading…" : `Upload ${previews.length}`}
            </button>
          </div>
        </div>
      )}

      {phase !== "idle" && (
        <div
          className={`rounded-md px-3 py-2 text-xs ${
            phase === "error"
              ? "bg-rose-50 text-rose-700"
              : phase === "done"
                ? failures.length === 0
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-800"
                : "bg-neutral-50 text-neutral-700"
          }`}
          role="status"
        >
          {phaseLabel[phase]}
        </div>
      )}

      {failures.length > 0 && (
        <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <div className="mb-1 font-medium">
            Background removal failed on {failures.length}:
          </div>
          <ul className="list-disc space-y-0.5 pl-4">
            {failures.map((f) => (
              <li key={f.imageId}>
                <code className="font-mono">{f.imageId.slice(0, 8)}</code> —{" "}
                {f.code}
                {f.msg ? ` (${f.msg})` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-1 text-[11px] text-amber-700">
            Each failed image shows a Retry button on its card below.
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
