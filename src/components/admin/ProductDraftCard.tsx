"use client";

/**
 * Wave 6 · Commit 4 — single card on the bulk-create page.
 *
 * Self-contained pure-preview state: photos picker (1-5), optional
 * GLB picker, delete button. No network IO inside the card — the
 * parent BulkCreateForm orchestrates the actual upload + server
 * action call when the operator clicks "Save all".
 *
 * Drag-and-drop: both the photos block and the GLB block accept real
 * filesystem drag-drops (same pattern as the single-product
 * UploadDropzone / FileDropzone — onDrop / onDragOver / onDragLeave
 * with a visual border/bg state on hover). Clicking still opens the
 * native file picker as a fallback.
 *
 * Why not reuse UploadDropzone / FileDropzone: those are tightly
 * coupled to StagedUploadsProvider (single-product form's commit-
 * on-Save model). Bulk-create orchestrates ALL cards at once, so
 * the per-card components stay simple — they just collect File
 * objects and surface them via callback.
 */

import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { checkGlbBudget, GlbBudgetExceededError } from "@/lib/admin/glb-budget";

const PHOTO_MAX = 5;
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
const PHOTO_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const GLB_ACCEPT = ".glb,model/gltf-binary,application/octet-stream";
const PHOTO_MAX_MB = 8;
const GLB_MAX_MB = 60;

export type GlbBudgetMeta = {
  sizeKb: number;
  vertexCount: number;
  maxTextureDim: number;
  decodedRamMb: number;
};

export type DraftCardState = {
  /** Stable card key for React + parent map. */
  cardId: string;
  photos: File[];
  glbFile: File | null;
  glbBudget: GlbBudgetMeta | null;
};

type Props = {
  index: number;
  state: DraftCardState;
  /** Disable picking + delete while a Save is in flight. */
  busy: boolean;
  /** Whether the parent will allow delete (false = only one card left). */
  canDelete: boolean;
  onChange: (next: DraftCardState) => void;
  onDelete: () => void;
};

export default function ProductDraftCard({
  index,
  state,
  busy,
  canDelete,
  onChange,
  onDelete,
}: Props) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [glbError, setGlbError] = useState<string | null>(null);
  const [photoDragging, setPhotoDragging] = useState(false);
  const [glbDragging, setGlbDragging] = useState(false);

  // Object URLs for previews. Revoke on unmount + on photo list
  // change to avoid leaking blob URLs.
  useEffect(() => {
    const urls = state.photos.map((f) => URL.createObjectURL(f));
    setPhotoUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [state.photos]);

  function acceptPhotos(incoming: File[]) {
    setPhotoErrors([]);
    if (incoming.length === 0) return;
    const errs: string[] = [];
    const vetted = incoming.filter((f) => {
      // Browsers report .heic / .tiff with mime ""; we accept only
      // jpg/png/webp by mime to avoid surprising rembg downstream.
      if (!PHOTO_MIMES.has(f.type)) {
        errs.push(`${f.name}: unsupported (${f.type || "unknown"})`);
        return false;
      }
      if (f.size > PHOTO_MAX_MB * 1024 * 1024) {
        errs.push(
          `${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB > ${PHOTO_MAX_MB} MB`,
        );
        return false;
      }
      return true;
    });
    if (errs.length) setPhotoErrors(errs);
    if (vetted.length === 0) return;
    const remaining = PHOTO_MAX - state.photos.length;
    const accepted = vetted.slice(0, remaining);
    onChange({ ...state, photos: [...state.photos, ...accepted] });
  }

  function onPhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    acceptPhotos(incoming);
  }

  function onPhotoDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setPhotoDragging(false);
    if (busy || state.photos.length >= PHOTO_MAX) return;
    acceptPhotos(Array.from(e.dataTransfer.files));
  }

  function onPhotoDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (busy || state.photos.length >= PHOTO_MAX) return;
    if (!photoDragging) setPhotoDragging(true);
  }

  function onPhotoDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setPhotoDragging(false);
  }

  function removePhoto(i: number) {
    const next = state.photos.slice();
    next.splice(i, 1);
    onChange({ ...state, photos: next });
  }

  async function acceptGlb(file: File | null) {
    setGlbError(null);
    if (!file) return;
    if (file.size > GLB_MAX_MB * 1024 * 1024) {
      setGlbError(`GLB too large (max ${GLB_MAX_MB} MB)`);
      return;
    }
    let report;
    try {
      report = await checkGlbBudget(file);
    } catch (err) {
      if (err instanceof GlbBudgetExceededError) {
        setGlbError(`Budget exceeded: ${err.message.split("\n")[0]}`);
      } else {
        setGlbError(
          `Budget check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return;
    }
    onChange({
      ...state,
      glbFile: file,
      glbBudget: {
        sizeKb: Math.round(file.size / 1024),
        vertexCount: report.totalVertices,
        maxTextureDim: report.largestTexture
          ? Math.max(
              report.largestTexture.width,
              report.largestTexture.height,
            )
          : 0,
        decodedRamMb: Math.round(report.estimatedDecodedMb),
      },
    });
  }

  function onGlbPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    void acceptGlb(f);
  }

  function onGlbDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setGlbDragging(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    // GLBs often report MIME "" or "application/octet-stream"; gate
    // on extension. Bad pick path is a budget-check failure with a
    // readable message, not a silent acceptance.
    if (!f) return;
    if (!/\.glb$/i.test(f.name)) {
      setGlbError(`${f.name}: not a .glb file`);
      return;
    }
    void acceptGlb(f);
  }

  function onGlbDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (busy) return;
    if (!glbDragging) setGlbDragging(true);
  }

  function onGlbDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setGlbDragging(false);
  }

  function clearGlb() {
    onChange({ ...state, glbFile: null, glbBudget: null });
    setGlbError(null);
  }

  const photoCapReached = state.photos.length >= PHOTO_MAX;

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900">
          Product #{index + 1}
        </h3>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-40"
          >
            Delete card
          </button>
        )}
      </div>

      {/* Photos */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Photos ({state.photos.length}/{PHOTO_MAX})
          </span>
          {!photoCapReached && (
            <button
              type="button"
              onClick={() => photoInputRef.current?.click()}
              disabled={busy}
              className="text-xs text-sky-700 hover:text-sky-900 disabled:opacity-40"
            >
              + Add photos
            </button>
          )}
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          onChange={onPhotoPick}
          className="hidden"
          data-testid={`photo-input-${index}`}
        />
        <div
          onDrop={onPhotoDrop}
          onDragOver={onPhotoDragOver}
          onDragLeave={onPhotoDragLeave}
          onClick={() => {
            if (!busy && !photoCapReached) photoInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          aria-label={`Drop photos for product ${index + 1}`}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              !busy &&
              !photoCapReached
            ) {
              e.preventDefault();
              photoInputRef.current?.click();
            }
          }}
          className={`relative rounded-md border-2 border-dashed p-3 transition ${
            busy
              ? "cursor-not-allowed border-neutral-300 bg-neutral-50 opacity-60"
              : photoCapReached
                ? "cursor-default border-neutral-200 bg-neutral-50"
                : photoDragging
                  ? "cursor-pointer border-black bg-neutral-100"
                  : "cursor-pointer border-neutral-300 bg-neutral-50 hover:border-neutral-500"
          }`}
        >
          {state.photos.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-neutral-500">
              Drop photos here, or click to pick — max 5, JPG/PNG/WebP.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-5 gap-2">
                {photoUrls.map((url, i) => (
                  <div
                    key={`${state.cardId}-photo-${i}`}
                    className="group relative aspect-square overflow-hidden rounded border border-neutral-200 bg-white"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`Photo ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                    {!busy && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removePhoto(i);
                        }}
                        aria-label={`Remove photo ${i + 1}`}
                        className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    )}
                    {i === 0 && (
                      <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 text-[10px] font-medium text-white">
                        cover
                      </span>
                    )}
                  </div>
                ))}
              </div>
              {!photoCapReached && (
                <div className="mt-2 text-center text-[11px] text-neutral-500">
                  Drop more photos here, or click — {PHOTO_MAX - state.photos.length} slot
                  {PHOTO_MAX - state.photos.length === 1 ? "" : "s"} left.
                </div>
              )}
            </>
          )}
        </div>
        {photoErrors.length > 0 && (
          <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {photoErrors.map((e, i) => (
              <div key={i}>{e}</div>
            ))}
          </div>
        )}
      </div>

      {/* GLB */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            3D model (optional)
          </span>
          {state.glbFile ? (
            <button
              type="button"
              onClick={clearGlb}
              disabled={busy}
              className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-40"
            >
              Clear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => glbInputRef.current?.click()}
              disabled={busy}
              className="text-xs text-sky-700 hover:text-sky-900 disabled:opacity-40"
            >
              + Add GLB
            </button>
          )}
        </div>
        <input
          ref={glbInputRef}
          type="file"
          accept={GLB_ACCEPT}
          onChange={onGlbPick}
          className="hidden"
          data-testid={`glb-input-${index}`}
        />
        <div
          onDrop={onGlbDrop}
          onDragOver={onGlbDragOver}
          onDragLeave={onGlbDragLeave}
          onClick={() => {
            if (!busy && !state.glbFile) glbInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          aria-label={`Drop GLB for product ${index + 1}`}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              !busy &&
              !state.glbFile
            ) {
              e.preventDefault();
              glbInputRef.current?.click();
            }
          }}
          className={`rounded-md border-2 border-dashed p-3 transition ${
            busy
              ? "cursor-not-allowed border-neutral-300 bg-neutral-50 opacity-60"
              : state.glbFile
                ? "cursor-default border-neutral-200 bg-neutral-50"
                : glbDragging
                  ? "cursor-pointer border-black bg-neutral-100"
                  : "cursor-pointer border-neutral-300 bg-neutral-50 hover:border-neutral-500"
          }`}
        >
          {state.glbFile ? (
            <div className="text-xs text-neutral-700">
              <div className="font-mono">{state.glbFile.name}</div>
              {state.glbBudget && (
                <div className="mt-0.5 text-[11px] text-neutral-500">
                  {state.glbBudget.sizeKb} KB ·{" "}
                  {state.glbBudget.vertexCount.toLocaleString()} verts ·{" "}
                  {state.glbBudget.decodedRamMb} MB decoded
                </div>
              )}
            </div>
          ) : (
            <div className="px-3 py-3 text-center text-xs text-neutral-500">
              Drop a .glb here, or click — optional, max {GLB_MAX_MB} MB.
            </div>
          )}
        </div>
        {glbError && (
          <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {glbError}
          </div>
        )}
      </div>
    </div>
  );
}
