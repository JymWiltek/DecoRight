"use client";

/**
 * Wave 11b — multi-file texture dropzone for the FBX bundle.
 *
 * A bare .fbx loads materialless in 3ds Max; the designer needs the
 * texture maps (JPEG/PNG) alongside. The operator drops 1-5 maps
 * here; on Save they're PUT to `products/<id>/textures/<filename>`
 * via the "texture" signed-upload kind, preserving the original
 * filename (the .fbx references its maps BY NAME). updateProduct then
 * fires the packaging step that zips fbx + textures/.
 *
 * Mirrors FileDropzone's staged-upload contract (register on mount,
 * PUT on Save) but multi-file like the photo UploadDropzone. Returns
 * one hidden field `textures_changed=<count>` so updateProduct knows
 * to (re)build the bundle. No DB rows — textures live only in Storage
 * and are enumerated at package time.
 */

import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { getSignedUploadUrl } from "@/app/admin/(dashboard)/products/upload-actions";
import {
  useLatestRef,
  useRegisterStagedUploader,
  useStagedUploads,
  type StagedField,
} from "./product-form-staging";

const ACCEPT = "image/jpeg,image/png,image/webp";
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_FILES = 5;
const MAX_MB = 20; // texture maps are typically 0.5-5 MB; 20 is slack

type Props = {
  productId: string | null;
  /** Existing texture filenames already in Storage (server-listed),
   *  shown as "current" chips so the operator knows what's bundled. */
  currentNames?: string[];
};

export default function TextureDropzone({ productId, currentNames }: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const { busy } = useStagedUploads();
  const disabled = !productId || busy;
  const pickedRef = useLatestRef(picked);

  useRegisterStagedUploader("texture_files", {
    label: "textures",
    pendingCount: () => pickedRef.current.length,
    run: async (onProgress) => {
      const files = pickedRef.current;
      if (files.length === 0 || !productId) return [];
      let done = 0;
      for (const file of files) {
        onProgress({ label: `texture (${file.name})`, done, total: files.length });
        const r = await getSignedUploadUrl(
          "texture",
          productId,
          file.name,
          file.type,
        );
        if (!r.ok) throw new Error(`texture ${file.name}: ${r.error}`);
        await putBytes(r.ticket.signedUrl, file);
        done++;
        onProgress({ label: `texture (${file.name})`, done, total: files.length });
      }
      const fields: StagedField[] = [
        { name: "textures_changed", value: String(files.length) },
      ];
      return fields;
    },
  });

  function take(incoming: File[]) {
    setError(null);
    const errs: string[] = [];
    const vetted = incoming.filter((f) => {
      if (!ALLOWED.has(f.type)) {
        errs.push(`${f.name}: unsupported (${f.type || "unknown"})`);
        return false;
      }
      if (f.size > MAX_MB * 1024 * 1024) {
        errs.push(`${f.name}: ${(f.size / 1024 / 1024).toFixed(1)} MB > ${MAX_MB} MB`);
        return false;
      }
      return true;
    });
    if (errs.length) setError(errs.join("; "));
    if (vetted.length === 0) return;
    const remaining = MAX_FILES - picked.length;
    setPicked([...picked, ...vetted.slice(0, remaining)]);
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    take(Array.from(e.target.files ?? []));
    e.currentTarget.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    take(Array.from(e.dataTransfer.files));
  }

  function removeAt(i: number) {
    setPicked(picked.filter((_, j) => j !== i));
  }

  const capReached = picked.length >= MAX_FILES;

  return (
    <div className="flex flex-col gap-2">
      <div
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !capReached && !dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragging(false);
        }}
        onClick={() => {
          if (!disabled && !capReached) pickerRef.current?.click();
        }}
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        className={`relative flex min-h-[80px] flex-col items-center justify-center rounded-md border-2 border-dashed p-3 text-center text-sm transition ${
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
          accept={ACCEPT}
          multiple
          hidden
          onChange={onPick}
        />
        {!productId ? (
          <div className="text-xs">Save the product first, then add textures.</div>
        ) : picked.length > 0 ? (
          <div className="w-full">
            <div className="flex flex-wrap gap-2">
              {picked.map((f, i) => (
                <span
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-1 rounded bg-white px-2 py-0.5 text-xs ring-1 ring-neutral-200"
                >
                  {f.name}
                  {!busy && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAt(i);
                      }}
                      className="text-neutral-400 hover:text-rose-600"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {!capReached && (
              <div className="mt-1 text-[11px] text-neutral-500">
                {MAX_FILES - picked.length} slot
                {MAX_FILES - picked.length === 1 ? "" : "s"} left · staged for Save
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="text-neutral-700">
              Drop texture maps here, or click — JPEG/PNG, max {MAX_FILES}.
            </div>
            <div className="mt-1 text-xs text-neutral-500">
              Filenames are preserved — the .fbx references its maps by name.
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {currentNames && currentNames.length > 0 && picked.length === 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
          <span className="text-neutral-400">In bundle:</span>
          {currentNames.map((n) => (
            <span
              key={n}
              className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-[11px]"
            >
              {n}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

async function putBytes(signedUrl: string, file: File): Promise<void> {
  const res = await fetch(signedUrl, {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "true",
      "cache-control": "max-age=31536000",
    },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`upload failed (${res.status}): ${text || res.statusText}`);
  }
}
