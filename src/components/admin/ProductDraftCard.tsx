"use client";

/**
 * Wave 6 · Commit 4 — single card on the bulk-create page.
 *
 * Self-contained pure-preview state: photos picker (1-5), optional
 * GLB picker, delete button. No network IO inside the card — the
 * parent BulkCreateForm orchestrates the actual upload + server
 * action call when the operator clicks "Save all".
 *
 * Why not reuse UploadDropzone / FileDropzone: those are tightly
 * coupled to StagedUploadsProvider (single-product form's commit-
 * on-Save model). Bulk-create orchestrates ALL cards at once, so
 * the per-card components stay simple — they just collect File
 * objects and surface them via callback.
 */

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { checkGlbBudget, GlbBudgetExceededError } from "@/lib/admin/glb-budget";

const PHOTO_MAX = 5;
const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";
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
  const [glbError, setGlbError] = useState<string | null>(null);

  // Object URLs for previews. Revoke on unmount + on photo list
  // change to avoid leaking blob URLs.
  useEffect(() => {
    const urls = state.photos.map((f) => URL.createObjectURL(f));
    setPhotoUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [state.photos]);

  function onPhotoPick(e: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = ""; // allow re-picking the same file
    if (incoming.length === 0) return;
    const remaining = PHOTO_MAX - state.photos.length;
    const accepted = incoming
      .filter((f) => f.size <= PHOTO_MAX_MB * 1024 * 1024)
      .slice(0, remaining);
    if (accepted.length === 0) return;
    onChange({ ...state, photos: [...state.photos, ...accepted] });
  }

  function removePhoto(i: number) {
    const next = state.photos.slice();
    next.splice(i, 1);
    onChange({ ...state, photos: next });
  }

  async function onGlbPick(e: ChangeEvent<HTMLInputElement>) {
    setGlbError(null);
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!f) return;
    if (f.size > GLB_MAX_MB * 1024 * 1024) {
      setGlbError(`GLB too large (max ${GLB_MAX_MB} MB)`);
      return;
    }
    let report;
    try {
      report = await checkGlbBudget(f);
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
      glbFile: f,
      glbBudget: {
        sizeKb: Math.round(f.size / 1024),
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

  function clearGlb() {
    onChange({ ...state, glbFile: null, glbBudget: null });
    setGlbError(null);
  }

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
          {state.photos.length < PHOTO_MAX && (
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
        />
        {state.photos.length === 0 ? (
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-6 text-center text-xs text-neutral-500">
            No photos yet. Click &ldquo;+ Add photos&rdquo; (max 5,
            JPG/PNG/WebP).
          </div>
        ) : (
          <div className="grid grid-cols-5 gap-2">
            {photoUrls.map((url, i) => (
              <div
                key={`${state.cardId}-photo-${i}`}
                className="group relative aspect-square overflow-hidden rounded border border-neutral-200 bg-neutral-100"
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
                    onClick={() => removePhoto(i)}
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
        />
        {state.glbFile ? (
          <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-700">
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
          <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 px-3 py-3 text-center text-xs text-neutral-500">
            No 3D model. Optional — drafts publish without one but
            need a GLB before final Publish.
          </div>
        )}
        {glbError && (
          <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {glbError}
          </div>
        )}
      </div>
    </div>
  );
}
