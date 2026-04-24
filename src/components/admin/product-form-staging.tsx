"use client";

/**
 * Shared staging state for the product form.
 *
 * Earlier direct-upload revision had each dropzone own its own
 * "click Upload → PUT → kickRembg" lifecycle. That violated the
 * Gmail-draft rule Jym called out: "nothing ships until the user
 * commits". So this refactor lifts upload execution to the parent
 * form: dropzones *stage* files (render previews, let the user ×
 * them out) but do NOT touch Storage or DB until Save / Publish
 * is clicked.
 *
 * Mechanics:
 *   - ProductForm (client) mounts a `<StagedUploadsProvider>` that
 *     holds a ref-keyed Map of uploader entries.
 *   - Each dropzone calls `useRegisterStagedUploader` on mount,
 *     passing a stable id and an imperative object that can be
 *     polled for `pendingCount()` and invoked via `run()`. The
 *     dropzone owns its own state; `run()` reads the latest state
 *     via a ref so the registration itself is mount-once.
 *   - When a submit button fires, ProductForm reads the clicked
 *     button's `intent` value, iterates every registered uploader
 *     sequentially (so Storage rate limits stay happy), collects
 *     the returned `StagedField[]` and appends them to FormData,
 *     then calls the server action.
 *   - While submitting, the context exposes `busy=true` so dropzones
 *     grey out their × / pick buttons.
 *
 * `StagedField` is deliberately generic — the raw-images dropzone
 * returns a JSON blob under one key, the GLB dropzone returns a
 * string path + a number size. The server action in products/actions.ts
 * decodes whatever shape it finds.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";

/** A hidden <input> worth of data — name/value appended to the
 *  FormData the server action receives. Appended, not set, so a
 *  dropzone can emit multiple entries under the same key. */
export type StagedField = { name: string; value: string };

/** Progress callback fed by a single uploader. `label` is whatever
 *  the uploader wants the status banner to show ("Uploading
 *  foo.jpg…"). `done` / `total` are that uploader's own counters —
 *  we don't aggregate, because a staged form rarely has more than
 *  two uploaders and the sequential UI reads better per-source. */
export type UploaderProgress = (info: {
  label: string;
  done: number;
  total: number;
}) => void;

export type StagedUploader = {
  /** How many files would this uploader PUT if run() fires right now?
   *  Read by ProductForm to compute the total for "Uploading 0/5…". */
  pendingCount: () => number;
  /** Execute the PUT phase. Returns hidden form fields to append. */
  run: (onProgress: UploaderProgress) => Promise<StagedField[]>;
  /** Short human label for the progress banner ("images", "3D model"). */
  label: string;
};

type Ctx = {
  register: (id: string, u: StagedUploader) => () => void;
  /** True while ProductForm is uploading + submitting. Dropzones
   *  read this to disable their controls. */
  busy: boolean;
};

const StagedCtx = createContext<Ctx | null>(null);

export function StagedUploadsProvider({
  busy,
  children,
  registryRef,
}: {
  busy: boolean;
  children: React.ReactNode;
  /** Parent (ProductForm) owns the mutable Map so it can iterate
   *  uploaders at submit time. We pass the ref down instead of
   *  stashing in provider state because we don't want re-renders
   *  on every register/unregister. */
  registryRef: React.MutableRefObject<Map<string, StagedUploader>>;
}) {
  const register = useCallback<Ctx["register"]>(
    (id, u) => {
      registryRef.current.set(id, u);
      return () => {
        // Only remove if it's still OUR entry (avoids a clobber if
        // a hot-reload remounts and re-registers with the same id
        // before the old cleanup fires).
        if (registryRef.current.get(id) === u) {
          registryRef.current.delete(id);
        }
      };
    },
    [registryRef],
  );

  const value = useMemo<Ctx>(() => ({ register, busy }), [register, busy]);
  return <StagedCtx.Provider value={value}>{children}</StagedCtx.Provider>;
}

export function useStagedUploads(): Ctx {
  const ctx = useContext(StagedCtx);
  if (!ctx) {
    // Fail loud in dev — a dropzone outside the provider would
    // silently no-op on Save, which is the exact bug class we're
    // refactoring to prevent.
    throw new Error(
      "useStagedUploads must be used inside <StagedUploadsProvider>",
    );
  }
  return ctx;
}

/**
 * Dropzone-side helper. Dropzones own mutable state (File[], File?);
 * registration happens exactly once on mount with a stable callback
 * that reads the *latest* state via the ref you pass in.
 *
 *   const previewsRef = useLatestRef(previews);
 *   useRegisterStagedUploader("raw_images", {
 *     label: "images",
 *     pendingCount: () => previewsRef.current.length,
 *     run: async (onProgress) => { … reads previewsRef.current … },
 *   });
 *
 * Don't put state-dependent closures inside the `run` handler
 * without going through a ref — React closures would capture stale
 * state from the mount-time render.
 */
export function useRegisterStagedUploader(
  id: string,
  uploader: StagedUploader,
) {
  const { register } = useStagedUploads();
  // Keep the uploader object stable across re-renders — only the
  // values it reads from refs should change, not the object itself.
  const uploaderRef = useRef(uploader);
  uploaderRef.current = uploader;

  useEffect(() => {
    const stable: StagedUploader = {
      label: uploaderRef.current.label,
      pendingCount: () => uploaderRef.current.pendingCount(),
      run: (p) => uploaderRef.current.run(p),
    };
    return register(id, stable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, register]);
}

/**
 * Small convenience: keep a ref in sync with a state value. Lets a
 * mount-once uploader read the current state without re-subscribing
 * every render.
 */
export function useLatestRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

/** Phase display states surfaced by ProductForm's submit lifecycle. */
export type SubmitPhase =
  | { kind: "idle" }
  | { kind: "uploading"; label: string; done: number; total: number }
  | { kind: "saving"; intent: "save" | "draft" | "publish" }
  | { kind: "error"; message: string };

/**
 * Tiny banner that renders SubmitPhase. Lives in the form header +
 * footer. Lives in this file so all the phase strings are in one
 * place — easy to translate later if we ever add i18n for admin.
 */
export function SubmitPhaseBanner({ phase }: { phase: SubmitPhase }) {
  if (phase.kind === "idle") return null;
  if (phase.kind === "uploading") {
    return (
      <div className="rounded-md bg-neutral-900 px-3 py-2 text-xs text-white">
        Uploading {phase.label} — {phase.done}/{phase.total}…
      </div>
    );
  }
  if (phase.kind === "saving") {
    return (
      <div className="rounded-md bg-neutral-900 px-3 py-2 text-xs text-white">
        {phase.intent === "publish"
          ? "Saving + running background removal (may take 10–30s per image)…"
          : "Saving…"}
      </div>
    );
  }
  return (
    <div className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
      {phase.message}
    </div>
  );
}
