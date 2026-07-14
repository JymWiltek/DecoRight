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
// Sprint 1 (PART B) — the FBX dropzone now also accepts a pre-packaged
// .zip (model.fbx + textures/), same as the single-product edit page.
const FBX_ACCEPT = ".fbx,.zip,application/octet-stream,application/zip";
const PHOTO_MAX_MB = 8;
const GLB_MAX_MB = 60;
// Wave 9 — FBX original for paid designer downloads. 100MB cap is
// the same Wave 9 admin edit page uses; the models bucket was bumped
// to 120MB in mig 0042 so this fits with headroom.
const FBX_MAX_MB = 100;
// Sprint 1 (PART B) — loose FBX texture maps. Server folds them into
// the zip bundle (packageFbxBundle). Generous caps: a PBR set can be
// 4-8 maps at 2-4K each.
const TEXTURE_MAX = 12;
const TEXTURE_MAX_MB = 25;
// Wave 9 — hard cap on real dimensions to keep typos from producing
// absurd AR scales. 10 m matches the single-product action's check.
const REAL_DIM_MAX_MM = 10_000;

export type GlbBudgetMeta = {
  sizeKb: number;
  vertexCount: number;
  maxTextureDim: number;
  decodedRamMb: number;
};

/**
 * Wave 9 — real product dimensions in mm, per-card. Same shape the
 * single-product edit page's Price & dimensions section writes into
 * products.dimensions_mm. NULL means "operator hasn't entered it
 * yet" — the storefront ModelViewer falls back to the GLB's
 * intrinsic scale, which is wrong but not broken.
 */
export type RealDimensionsMm = {
  length?: number;
  width?: number;
  height?: number;
};

/** Wave 7 fix-2 — per-photo "what role does this image play".
 *
 *  "product"   — actual product photo. Goes through rembg →
 *                cutout_image_url, shown in the storefront gallery,
 *                feed_to_ai=true so the V2 parser can read it.
 *                image_kind='cutout' on the row.
 *  "reference" — spec sheet / web screenshot / dimension diagram
 *                kind of thing the operator wants the AI to READ
 *                but never display to customers. Skips rembg (which
 *                would shred the text), feed_to_ai=true, but
 *                show_on_storefront=false. image_kind='real_photo'
 *                — reusing the Wave 4 enum value whose pipeline
 *                semantics already mean "skip rembg".
 *
 *  Default per slot: index 0 = product (the cover), index 1-4 =
 *  reference (operator typically drops the hero shot first, then
 *  spec sheets / extra angles). Operator can flip any slot. */
export type PhotoType = "product" | "reference";

export type DraftCardState = {
  /** Stable card key for React + parent map. */
  cardId: string;
  photos: File[];
  /** Parallel array to `photos`. Same length, same order. */
  photoTypes: PhotoType[];
  glbFile: File | null;
  glbBudget: GlbBudgetMeta | null;
  /** Wave 9 — FBX original for paid designer downloads. Independent
   *  of the GLB (operator can attach either, both, or neither). No
   *  budget metadata: FBX is never rendered in the storefront. The
   *  file may be a bare .fbx OR a pre-packaged .zip — see fbxIsZip. */
  fbxFile: File | null;
  /** Sprint 1 (PART B) — true when fbxFile is a pre-packaged .zip
   *  (model.fbx + textures/). Drives the fbx_bundle upload kind and
   *  which server column gets written; textureFiles are ignored. */
  fbxIsZip: boolean;
  /** Sprint 1 (PART B) — loose FBX texture maps the server folds into
   *  the zip bundle. Ignored when fbxIsZip (the zip already carries
   *  its own textures/). */
  textureFiles: File[];
  /** Wave 9 — real-world dimensions in mm. Operator types these from
   *  the product spec sheet; the storefront ModelViewer rescales
   *  the loaded GLB so AR placement matches true size. */
  realDimensions: RealDimensionsMm;
  /** Sprint 1 (PART B) — category (reuses item_type) + room
   *  (reuses room_slugs), the SAME columns single-edit writes. All
   *  optional: the AI tail can infer item_type from the photos. */
  itemType: string | null;
  subtypeSlug: string | null;
  roomSlugs: string[];
  /** Mig 0048 — supplier ids linked in bulk (defaults: in_stock, no
   *  price). Per-channel price/buy-url are set later in single-edit. */
  supplierIds: string[];
};

/** Default the per-photo type. First slot is the hero (Product),
 *  the rest start as Reference because the bulk-upload pattern is
 *  "1 hero photo + spec sheets + web screenshots". */
export function defaultPhotoType(slotIndex: number): PhotoType {
  return slotIndex === 0 ? "product" : "reference";
}

/** {slug,label} pair for a taxonomy <select>/checkbox. */
export type TaxoOption = { slug: string; label: string };

type Props = {
  index: number;
  state: DraftCardState;
  /** Disable picking + delete while a Save is in flight. */
  busy: boolean;
  /** Whether the parent will allow delete (false = only one card left). */
  canDelete: boolean;
  onChange: (next: DraftCardState) => void;
  onDelete: () => void;
  /** Sprint 1 (PART B) — category (= item_type) options, room options,
   *  and the subtype list keyed by item_type. Loaded server-side and
   *  passed down so the card matches single-edit's taxonomy exactly. */
  itemTypeOptions: TaxoOption[];
  roomOptions: TaxoOption[];
  subtypesByItemType: Record<string, TaxoOption[]>;
  /** Mig 0048 — suppliers to bulk-link (id + name). */
  supplierOptions: { id: string; name: string }[];
};

export default function ProductDraftCard({
  index,
  state,
  busy,
  canDelete,
  onChange,
  onDelete,
  itemTypeOptions,
  roomOptions,
  subtypesByItemType,
  supplierOptions,
}: Props) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const glbInputRef = useRef<HTMLInputElement>(null);
  const fbxInputRef = useRef<HTMLInputElement>(null);
  const textureInputRef = useRef<HTMLInputElement>(null);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [photoErrors, setPhotoErrors] = useState<string[]>([]);
  const [glbError, setGlbError] = useState<string | null>(null);
  const [fbxError, setFbxError] = useState<string | null>(null);
  const [textureError, setTextureError] = useState<string | null>(null);
  const [photoDragging, setPhotoDragging] = useState(false);
  const [glbDragging, setGlbDragging] = useState(false);
  const [fbxDragging, setFbxDragging] = useState(false);

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
    // Assign each new photo the default type for the slot it lands
    // in (index = current length + i). This is why operator
    // experience is "drop the hero photo first" — it auto-picks
    // Product. Slots 1+ default to Reference.
    const newTypes = accepted.map((_, i) =>
      defaultPhotoType(state.photos.length + i),
    );
    onChange({
      ...state,
      photos: [...state.photos, ...accepted],
      photoTypes: [...state.photoTypes, ...newTypes],
    });
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
    const nextPhotos = state.photos.slice();
    const nextTypes = state.photoTypes.slice();
    nextPhotos.splice(i, 1);
    nextTypes.splice(i, 1);
    onChange({ ...state, photos: nextPhotos, photoTypes: nextTypes });
  }

  function setPhotoType(i: number, t: PhotoType) {
    const nextTypes = state.photoTypes.slice();
    nextTypes[i] = t;
    onChange({ ...state, photoTypes: nextTypes });
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

  // ─── Wave 9 — FBX dropzone handlers ───────────────────────
  //
  // Mirrors the GLB handlers but skips the decoded-budget pre-check
  // (FBX never renders in the storefront, so the iOS Safari OOM
  // gate doesn't apply). Extension-gated rather than MIME-gated
  // because browsers report "" or "application/octet-stream" for
  // .fbx in practice.

  function acceptFbx(file: File | null) {
    setFbxError(null);
    if (!file) return;
    // Sprint 1 (PART B) — accept a bare .fbx OR a pre-packaged .zip
    // (model.fbx + textures/). Extension-gated: browsers report "" or
    // "application/octet-stream" for .fbx, and .zip is octet too.
    const isZip = /\.zip$/i.test(file.name);
    const isFbx = /\.fbx$/i.test(file.name);
    if (!isZip && !isFbx) {
      setFbxError(`${file.name}: not a .fbx or .zip file`);
      return;
    }
    if (file.size > FBX_MAX_MB * 1024 * 1024) {
      setFbxError(
        `${file.name}: ${(file.size / 1024 / 1024).toFixed(1)} MB > ${FBX_MAX_MB} MB`,
      );
      return;
    }
    onChange({ ...state, fbxFile: file, fbxIsZip: isZip });
  }

  function onFbxPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    e.target.value = "";
    acceptFbx(f);
  }

  function onFbxDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setFbxDragging(false);
    if (busy) return;
    const f = e.dataTransfer.files?.[0];
    acceptFbx(f ?? null);
  }

  function onFbxDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (busy) return;
    if (!fbxDragging) setFbxDragging(true);
  }

  function onFbxDragLeave(e: DragEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setFbxDragging(false);
  }

  function clearFbx() {
    onChange({ ...state, fbxFile: null, fbxIsZip: false });
    setFbxError(null);
  }

  // ─── Sprint 1 (PART B) — texture handlers ─────────────────
  //
  // Loose FBX texture maps the server folds into the zip bundle
  // (packageFbxBundle). Multi-pick, click-only (no drag) to keep the
  // card compact. No mime gate — .tga / .exr report empty mime — only
  // a size cap and a count cap. Ignored when fbxIsZip (the zip carries
  // its own textures/).

  function acceptTextures(incoming: File[]) {
    setTextureError(null);
    if (incoming.length === 0) return;
    const errs: string[] = [];
    const vetted = incoming.filter((f) => {
      if (f.size > TEXTURE_MAX_MB * 1024 * 1024) {
        errs.push(
          `${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB > ${TEXTURE_MAX_MB} MB`,
        );
        return false;
      }
      return true;
    });
    if (errs.length) setTextureError(errs.join(" · "));
    if (vetted.length === 0) return;
    const remaining = TEXTURE_MAX - state.textureFiles.length;
    if (remaining <= 0) {
      setTextureError(`max ${TEXTURE_MAX} textures`);
      return;
    }
    onChange({
      ...state,
      textureFiles: [...state.textureFiles, ...vetted.slice(0, remaining)],
    });
  }

  function onTexturePick(e: ChangeEvent<HTMLInputElement>) {
    const incoming = Array.from(e.target.files ?? []);
    e.target.value = "";
    acceptTextures(incoming);
  }

  function removeTexture(i: number) {
    const next = state.textureFiles.slice();
    next.splice(i, 1);
    onChange({ ...state, textureFiles: next });
  }

  // ─── Sprint 1 (PART B) — category (item_type) + room handlers ──
  //
  // Reuses the same columns single-edit writes (item_type / subtype_slug
  // / room_slugs). All optional — the AI tail can infer item_type from
  // the photos when the operator leaves it blank.

  function setItemType(slug: string) {
    const next = slug || null;
    // Drop a now-orphaned subtype if it doesn't belong to the new type.
    const allowed = next ? (subtypesByItemType[next] ?? []) : [];
    const keepSub =
      state.subtypeSlug && allowed.some((s) => s.slug === state.subtypeSlug)
        ? state.subtypeSlug
        : null;
    onChange({ ...state, itemType: next, subtypeSlug: keepSub });
  }

  function setSubtype(slug: string) {
    onChange({ ...state, subtypeSlug: slug || null });
  }

  function toggleRoom(slug: string) {
    const has = state.roomSlugs.includes(slug);
    onChange({
      ...state,
      roomSlugs: has
        ? state.roomSlugs.filter((r) => r !== slug)
        : [...state.roomSlugs, slug],
    });
  }

  function toggleSupplier(id: string) {
    const has = state.supplierIds.includes(id);
    onChange({
      ...state,
      supplierIds: has
        ? state.supplierIds.filter((x) => x !== id)
        : [...state.supplierIds, id],
    });
  }

  // ─── Wave 9 — real dimensions handler ─────────────────────
  //
  // Per-axis numeric input. Empty string clears the axis. Values
  // outside [1, 10000] mm reject silently — the server-side
  // validation in bulkCreateProducts is the authoritative gate; this
  // is just UX defense against typos.

  function setDim(axis: keyof RealDimensionsMm, raw: string) {
    const trimmed = raw.trim();
    const next: RealDimensionsMm = { ...state.realDimensions };
    if (trimmed === "") {
      delete next[axis];
    } else {
      const n = Number(trimmed);
      if (Number.isFinite(n) && n > 0 && n <= REAL_DIM_MAX_MM) {
        next[axis] = Math.round(n);
      } else {
        // Reject the value; leave the previous good one in state.
        // No setState path; React will still rerender with the
        // user's typed string in the controlled-input value below.
        return;
      }
    }
    onChange({ ...state, realDimensions: next });
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
                {photoUrls.map((url, i) => {
                  const type =
                    state.photoTypes[i] ?? defaultPhotoType(i);
                  return (
                    <div
                      key={`${state.cardId}-photo-${i}`}
                      className="flex flex-col gap-1"
                    >
                      <div className="group relative aspect-square overflow-hidden rounded border border-neutral-200 bg-white">
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
                        {i === 0 && type === "product" && (
                          <span className="absolute left-1 top-1 rounded bg-emerald-600 px-1 text-[10px] font-medium text-white">
                            cover
                          </span>
                        )}
                        {type === "reference" && (
                          <span className="absolute left-1 top-1 rounded bg-amber-600 px-1 text-[10px] font-medium text-white">
                            ref
                          </span>
                        )}
                      </div>
                      {/* Wave 7 fix-2 — per-slot type dropdown.
                          Native <select> for zero extra component
                          deps. Stop propagation so clicks don't
                          re-trigger the parent file picker. */}
                      <select
                        value={type}
                        onChange={(e) => {
                          e.stopPropagation();
                          setPhotoType(i, e.target.value as PhotoType);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        disabled={busy}
                        aria-label={`Type for photo ${i + 1}`}
                        className="w-full rounded border border-neutral-300 bg-white px-1 py-0.5 text-[10px] text-neutral-700 disabled:opacity-50"
                      >
                        <option value="product">Product photo</option>
                        <option value="reference">Reference</option>
                      </select>
                    </div>
                  );
                })}
              </div>
              {!photoCapReached && (
                <div className="mt-2 text-center text-[11px] text-neutral-500">
                  Drop more photos here, or click — {PHOTO_MAX - state.photos.length} slot
                  {PHOTO_MAX - state.photos.length === 1 ? "" : "s"} left.
                </div>
              )}
              <div className="mt-2 rounded bg-neutral-50 px-2 py-1 text-[10px] leading-tight text-neutral-500">
                <strong className="text-neutral-700">Product photo</strong> = shown on
                storefront, background removed.{" "}
                <strong className="text-neutral-700">Reference</strong> = spec sheet /
                screenshot, AI reads it but customers don&apos;t see it.{" "}
                <span className="text-amber-700">
                  Remove&nbsp;Background / Unify&nbsp;Center 在保存后打开该草稿的编辑页使用（产品行此刻还不存在）。
                </span>
              </div>
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

      {/* Sprint 1 (PART B) — category (item_type) + subtype + room.
          Reuses the same columns single-edit writes; all optional. The
          AI tail can fill item_type when the operator leaves it blank. */}
      <div className="mb-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Category
          </span>
          <select
            value={state.itemType ?? ""}
            onChange={(e) => setItemType(e.target.value)}
            disabled={busy}
            data-testid={`item-type-${index}`}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 disabled:opacity-50"
          >
            <option value="">— optional (AI can fill) —</option>
            {itemTypeOptions.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Subtype
          </span>
          <select
            value={state.subtypeSlug ?? ""}
            onChange={(e) => setSubtype(e.target.value)}
            disabled={busy || !state.itemType}
            data-testid={`subtype-${index}`}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 disabled:opacity-50"
          >
            <option value="">
              {state.itemType ? "— optional —" : "— pick a category first —"}
            </option>
            {(state.itemType
              ? (subtypesByItemType[state.itemType] ?? [])
              : []
            ).map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mb-3">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Rooms ({state.roomSlugs.length})
        </span>
        <div className="flex flex-wrap gap-1.5">
          {roomOptions.map((o) => {
            const on = state.roomSlugs.includes(o.slug);
            return (
              <button
                key={o.slug}
                type="button"
                onClick={() => toggleRoom(o.slug)}
                disabled={busy}
                aria-pressed={on}
                data-testid={`room-${o.slug}-${index}`}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                  on
                    ? "border-black bg-black text-white"
                    : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
      {/* Real dimensions — grouped with the other product ATTRIBUTES
          (category / rooms), matching the single-edit form's chapter 5.0.
          Persisted to products.dimensions_mm; drives storefront AR scale. */}
      <div className="mb-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Real dimensions (mm) — optional, drives AR scale
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-neutral-500">
              Length
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={REAL_DIM_MAX_MM}
              value={state.realDimensions.length ?? ""}
              onChange={(e) => setDim("length", e.target.value)}
              disabled={busy}
              placeholder="mm"
              data-testid={`dim-length-${index}`}
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-neutral-500">
              Width
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={REAL_DIM_MAX_MM}
              value={state.realDimensions.width ?? ""}
              onChange={(e) => setDim("width", e.target.value)}
              disabled={busy}
              placeholder="mm"
              data-testid={`dim-width-${index}`}
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 disabled:opacity-50"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase text-neutral-500">
              Height
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={REAL_DIM_MAX_MM}
              value={state.realDimensions.height ?? ""}
              onChange={(e) => setDim("height", e.target.value)}
              disabled={busy}
              placeholder="mm"
              data-testid={`dim-height-${index}`}
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 disabled:opacity-50"
            />
          </label>
        </div>
      </div>
      {supplierOptions.length > 0 && (
        <div className="mb-3">
          <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">
            Retailer / Supplier ({state.supplierIds.length})
          </span>
          <div className="flex flex-wrap gap-1.5">
            {supplierOptions.map((o) => {
              const on = state.supplierIds.includes(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => toggleSupplier(o.id)}
                  disabled={busy}
                  aria-pressed={on}
                  data-testid={`supplier-${o.id}-${index}`}
                  className={`rounded-full border px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
                    on
                      ? "border-black bg-black text-white"
                      : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                  }`}
                >
                  {o.name}
                </button>
              );
            })}
          </div>
          <p className="mt-1 text-[10px] text-neutral-400">
            Tap to link the retailer(s) that stock this product (in-stock, no
            price). Set per-channel price / buy URL later in single-product
            edit — no need to revisit each product just to attach a retailer.
          </p>
        </div>
      )}

      {/* 3D MODEL section header — UI parity with single-product edit.
          Recommended Tripo/Meshy settings + Wave 9 explanation. */}
      <div className="mb-2 rounded bg-neutral-50 px-2 py-1.5 text-[10px] leading-tight text-neutral-600">
        <strong className="text-neutral-700">Recommended Tripo/Meshy:</strong>{" "}
        HD Texture ON, PBR OFF, Polycount 300K-500K. The .glb is
        auto-compressed to AR-ready ~3 MB on Save; the .fbx is preserved
        bit-exact for paid designer downloads. Fill real dimensions so
        the storefront AR shows true size.
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

      {/* Wave 9 — FBX dropzone (optional, paid designer download).
          Mirrors the GLB dropzone shape for visual parity with the
          single-product edit page's 3D MODELS section. */}
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            FBX original (optional)
          </span>
          {state.fbxFile ? (
            <button
              type="button"
              onClick={clearFbx}
              disabled={busy}
              className="text-xs text-rose-600 hover:text-rose-800 disabled:opacity-40"
            >
              Clear
            </button>
          ) : (
            <button
              type="button"
              onClick={() => fbxInputRef.current?.click()}
              disabled={busy}
              className="text-xs text-sky-700 hover:text-sky-900 disabled:opacity-40"
            >
              + Add FBX
            </button>
          )}
        </div>
        <input
          ref={fbxInputRef}
          type="file"
          accept={FBX_ACCEPT}
          onChange={onFbxPick}
          className="hidden"
          data-testid={`fbx-input-${index}`}
        />
        <div
          onDrop={onFbxDrop}
          onDragOver={onFbxDragOver}
          onDragLeave={onFbxDragLeave}
          onClick={() => {
            if (!busy && !state.fbxFile) fbxInputRef.current?.click();
          }}
          role="button"
          tabIndex={0}
          aria-label={`Drop FBX for product ${index + 1}`}
          onKeyDown={(e) => {
            if (
              (e.key === "Enter" || e.key === " ") &&
              !busy &&
              !state.fbxFile
            ) {
              e.preventDefault();
              fbxInputRef.current?.click();
            }
          }}
          className={`rounded-md border-2 border-dashed p-3 transition ${
            busy
              ? "cursor-not-allowed border-neutral-300 bg-neutral-50 opacity-60"
              : state.fbxFile
                ? "cursor-default border-neutral-200 bg-neutral-50"
                : fbxDragging
                  ? "cursor-pointer border-black bg-neutral-100"
                  : "cursor-pointer border-neutral-300 bg-neutral-50 hover:border-neutral-500"
          }`}
        >
          {state.fbxFile ? (
            <div className="text-xs text-neutral-700">
              <div className="font-mono">{state.fbxFile.name}</div>
              <div className="mt-0.5 text-[11px] text-neutral-500">
                {(state.fbxFile.size / 1024).toFixed(0)} KB · designer download
                {state.fbxIsZip ? " · zip bundle (.fbx + textures/)" : ""}
              </div>
            </div>
          ) : (
            <div className="px-3 py-3 text-center text-xs text-neutral-500">
              Drop a .fbx or a .zip here, or click — for designer downloads
              (3ds Max / Maya / SketchUp). A .zip should hold model.fbx +
              a textures/ folder. Max {FBX_MAX_MB} MB.
            </div>
          )}
        </div>
        {fbxError && (
          <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
            {fbxError}
          </div>
        )}
      </div>

      {/* Sprint 1 (PART B) — loose FBX texture maps. Folded into the
          zip bundle server-side (packageFbxBundle). Hidden when the
          operator uploaded a pre-packaged .zip — that already carries
          its own textures/. */}
      {!state.fbxIsZip && (
        <div className="mt-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              FBX textures (optional, {state.textureFiles.length}/{TEXTURE_MAX})
            </span>
            {state.textureFiles.length < TEXTURE_MAX && (
              <button
                type="button"
                onClick={() => textureInputRef.current?.click()}
                disabled={busy}
                className="text-xs text-sky-700 hover:text-sky-900 disabled:opacity-40"
              >
                + Add textures
              </button>
            )}
          </div>
          <input
            ref={textureInputRef}
            type="file"
            multiple
            onChange={onTexturePick}
            className="hidden"
            data-testid={`texture-input-${index}`}
          />
          {state.textureFiles.length === 0 ? (
            <button
              type="button"
              onClick={() => !busy && textureInputRef.current?.click()}
              disabled={busy}
              className="w-full rounded-md border-2 border-dashed border-neutral-300 bg-neutral-50 px-3 py-3 text-center text-xs text-neutral-500 hover:border-neutral-500 disabled:opacity-60"
            >
              Add the .fbx&apos;s texture maps (jpg/png/tga…) — bundled with
              the FBX for designer download. Max {TEXTURE_MAX_MB} MB each.
            </button>
          ) : (
            <ul className="space-y-1">
              {state.textureFiles.map((f, i) => (
                <li
                  key={`${state.cardId}-tex-${i}-${f.name}`}
                  className="flex items-center justify-between rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-700"
                >
                  <span className="truncate font-mono">{f.name}</span>
                  <span className="flex items-center gap-2 pl-2">
                    <span className="shrink-0 text-neutral-400">
                      {(f.size / 1024).toFixed(0)} KB
                    </span>
                    {!busy && (
                      <button
                        type="button"
                        onClick={() => removeTexture(i)}
                        aria-label={`Remove texture ${f.name}`}
                        className="text-rose-600 hover:text-rose-800"
                      >
                        ×
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {textureError && (
            <div className="mt-1 rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
              {textureError}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
