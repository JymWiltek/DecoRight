"use client";

/**
 * Single-file dropzone (currently only used for the GLB model).
 * Pure-preview — nothing touches Storage until the form Save /
 * Publish button fires.
 *
 * Mechanics:
 *   - User picks / drops a file → we stash it in component state and
 *     render filename + size + a Clear button. No network IO.
 *   - For .glb files ≥ 20 MB: we transparently run client-side Draco
 *     compression before staging, so a 62 MB Meshy export that would
 *     otherwise blow past the 60 MB bucket cap becomes ~8 MB on its
 *     way in. Files under 20 MB upload as-is — sparing the user a
 *     20 s spinner for storage savings of cents per month (see the
 *     COMPRESS_THRESHOLD_BYTES doc in compress-glb.ts for the math).
 *     Compression lives in a dynamically-imported module
 *     (`@/lib/admin/compress-glb`) so the gltf-transform + draco3dgltf
 *     stack stays out of every other bundle, including the entire
 *     storefront. See that module's header for the design notes.
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

/** Inline format helper — one place, two callsites below. */
function fmtMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type CompressionStat = {
  originalBytes: number;
  compressedBytes: number;
  ratio: number;
  /** Did compression actually run, or was the file under the threshold? */
  ran: boolean;
};

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
  // Two compression-flow states. `compressing` flips the dropzone into
  // a non-interactive spinner-y state while the WASM round-trip runs.
  // `compressionStat` survives until the user clears or replaces the
  // file, so the "62.1 MB → 8.3 MB (87 % smaller)" line stays visible
  // through the staged-upload step.
  const [compressing, setCompressing] = useState(false);
  const [compressionStat, setCompressionStat] = useState<CompressionStat | null>(
    null,
  );
  const maxBytes = maxFileMb * 1024 * 1024;

  const { busy } = useStagedUploads();
  const disabled = !productId || busy || compressing;

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

  function vetFormat(f: File): string | null {
    if (!accept) return null;
    const allowed = accept.split(",").map((m) => m.trim());
    // .glb often has empty / octet-stream type — accept by extension.
    const extOk = accept.includes(".glb") && /\.glb$/i.test(f.name);
    if (!extOk && f.type && !allowed.includes(f.type)) {
      return `${f.name}: unsupported format (${f.type || "unknown"})`;
    }
    return null;
  }

  function vetSize(f: File): string | null {
    if (f.size > maxBytes) {
      const mb = (f.size / 1024 / 1024).toFixed(1);
      return `${f.name}: ${mb} MB exceeds ${maxFileMb} MB limit — please compress further`;
    }
    return null;
  }

  /**
   * Take a user-picked file and stage it.
   *
   * For .glb (kind === "glb"): run the client-side Draco pipeline
   * BEFORE the size vet, so a 62 MB Meshy export that compresses to
   * 8 MB clears the 60 MB bucket cap.
   *
   * Failure mode: if the compression module throws (WASM unsupported,
   * malformed .glb, OOM on a hostile input), we silently fall back to
   * the original bytes and run them through the usual size vet —
   * matching the pre-compression behaviour for users on browsers
   * where the pipeline can't run. A `console.warn` records the cause
   * for triage without leaking jargon to the operator.
   */
  async function take(f: File) {
    const fmtErr = vetFormat(f);
    if (fmtErr) {
      setError(fmtErr);
      return;
    }
    if (!productId) {
      setError(
        "Save the product first (just the name is enough) — then attach the .glb on the edit page.",
      );
      return;
    }
    setError(null);
    setCompressionStat(null);

    // Decide whether to run the Draco pipeline. We keep this gated to
    // kind === "glb" so future callers (image dropzones, etc.) don't
    // accidentally pull in the gltf-transform stack.
    const shouldCompress = kind === "glb" && /\.glb$/i.test(f.name);

    let staged: File = f;

    if (shouldCompress) {
      setCompressing(true);
      try {
        const { compressGlb, GlbTooLargeError } = await import(
          "@/lib/admin/compress-glb"
        );
        try {
          const result = await compressGlb(f);
          staged = result.file;
          setCompressionStat({
            originalBytes: result.originalBytes,
            compressedBytes: result.compressedBytes,
            ratio: result.ratio,
            ran: result.compressedBytes < result.originalBytes,
          });
        } catch (e) {
          if (e instanceof GlbTooLargeError) {
            // Pre-compression ceiling — Draco never even started, so
            // the original file is too big to bother retrying. Bail
            // with a friendly explicit message.
            setCompressing(false);
            const mb = (e.originalBytes / 1024 / 1024).toFixed(1);
            const ceilMb = (e.ceilingBytes / 1024 / 1024).toFixed(0);
            setError(
              `${f.name}: ${mb} MB exceeds the ${ceilMb} MB pre-compression ceiling — please decimate the model in Blender (or another tool) before uploading.`,
            );
            return;
          }
          // Generic failure — fall through to the existing fallback
          // path: keep original, console.warn, let vetSize decide.
          throw e;
        }
      } catch (e) {
        // Graceful fallback per the design contract: keep the original
        // file, log to console for triage, let the size vet decide
        // whether to accept it. The user only sees an error if the
        // original is over the bucket cap.
        console.warn("[admin/glb] compression failed, falling back to original:", e);
        staged = f;
        setCompressionStat(null);
      } finally {
        setCompressing(false);
      }
    }

    const sizeErr = vetSize(staged);
    if (sizeErr) {
      setError(sizeErr);
      // Keep the compressionStat visible so the operator sees "62 MB →
      // 61 MB" — the rare case where compression couldn't squeeze the
      // file under the cap. Tells them whether to retry vs. give up.
      return;
    }

    // Decoded-budget pre-check — runs on the FINAL staged bytes whether
    // or not compression engaged. Catches the iOS-Safari-OOM scenario
    // where a Draco-compressed 8 MB GLB hides 1 M+ verts and a 4096²
    // texture inside (see /product/9dbd6623 incident, 2026-05-09 0:47).
    // We import from the same module as compressGlb so the lazy chunk
    // is reused; if the compression branch already ran, this is a
    // no-cost re-import.
    if (kind === "glb" && /\.glb$/i.test(staged.name)) {
      try {
        const { checkGlbBudget, GlbBudgetExceededError } = await import(
          "@/lib/admin/compress-glb"
        );
        try {
          await checkGlbBudget(staged);
        } catch (e) {
          if (e instanceof GlbBudgetExceededError) {
            setError(e.message);
            return;
          }
          // Parse failures (malformed glb, unexpected chunk layout) —
          // log + let the file through. The post-upload renderer will
          // surface a more specific error if the file is genuinely
          // broken; we don't want budget-checker brittleness to block
          // legitimate uploads.
          console.warn(
            "[admin/glb] budget check parse failed, allowing through:",
            e,
          );
        }
      } catch (importErr) {
        // The dynamic import itself failed — exceedingly rare (network
        // hiccup mid-pick) but we keep the user moving rather than
        // hard-rejecting on tooling failure.
        console.warn("[admin/glb] budget checker unavailable:", importErr);
      }
    }

    setPicked(staged);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f) void take(f);
  }

  function onClear(e: React.MouseEvent) {
    e.stopPropagation();
    if (disabled) return;
    setPicked(null);
    setError(null);
    setCompressionStat(null);
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
            if (f) void take(f);
            e.currentTarget.value = "";
          }}
        />
        {!productId ? (
          <div className="text-xs">
            Save the product first (just the name works), then drop a{" "}
            .glb here on the edit page.
          </div>
        ) : compressing ? (
          // Active compression — non-interactive while WASM works.
          // The label shows the original (pre-compression) size since
          // we don't know the final size until the pipeline finishes.
          <>
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2 text-neutral-700"
            >
              <span
                aria-hidden
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700"
              />
              <span className="font-medium">Compressing .glb…</span>
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              First-time use loads ~600 KB of WebAssembly · subsequent files reuse the cache
            </div>
          </>
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
              Up to {maxFileMb} MB after compression · staged for Save
            </div>
          </>
        )}
      </div>

      {/*
        Compression stat line — only shown when the Draco pipeline
        actually ran (file ≥ 20 MB threshold). Kept above the error
        banner so the operator sees BOTH "we compressed 62→61" AND
        "but it's still too big" in the rare oversize case.
      */}
      {compressionStat && compressionStat.ran && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Compressed {fmtMb(compressionStat.originalBytes)} →{" "}
          {fmtMb(compressionStat.compressedBytes)} (
          {Math.round(compressionStat.ratio * 100)}% smaller)
        </div>
      )}

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
