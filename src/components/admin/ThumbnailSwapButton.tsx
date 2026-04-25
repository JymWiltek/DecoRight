"use client";

/**
 * Inline thumbnail swap button for the /admin product list. Replaces
 * the static 40×40 <img> + "no img" placeholder with an interactive
 * tile that:
 *
 *   - Idle: shows the current thumbnail (or "no img" when null), hover
 *     reveals a "Swap" overlay with a pencil icon so the swap-on-click
 *     affordance isn't a surprise.
 *   - Click: opens a hidden <input type="file"> file picker, accept=image/*.
 *   - Pick: validates MIME + size client-side, mints a signed URL via
 *     getSignedUploadUrl("thumbnail", …), PUTs bytes direct to Supabase
 *     Storage (bypassing Vercel's 4.5 MB body cap), then calls
 *     setProductThumbnail to write products.thumbnail_url. Finally
 *     router.refresh() so the row picks up the new URL on the next paint.
 *   - Uploading: dim + spinner overlay, button disabled.
 *   - Error: red border + hover tooltip with the failure reason. Auto
 *     clears 5s later so the operator can try again without a page reload.
 *
 * Why the same component handles both cases (has-thumb / no-thumb):
 *   The interaction is identical — the only difference is what's
 *   inside the tile. Forking would mean two places to keep the upload
 *   plumbing in sync.
 *
 * Why client-side MIME + size validation BEFORE minting the signed URL:
 *   A 50 MB PDF dropped here would otherwise eat one signed-URL
 *   round-trip and a Storage PUT before failing — wasteful and slow
 *   to feedback. MAX_BYTES matches what the raw-image dropzone
 *   accepts (8 MB) so the rule is consistent.
 *
 * Why no confirm() before replacing an existing thumbnail:
 *   Picking a file is itself the confirmation. Admin UI is consistent
 *   on this — nothing else in /admin double-prompts.
 *
 * Why router.refresh() and not optimistic local state:
 *   The new URL contains ?v=Date.now() that's only known server-side
 *   (after setProductThumbnail finalizes). Optimistic state would have
 *   to guess that timestamp — easier to just refetch and let RSC
 *   render the truth.
 */

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSignedUploadUrl } from "@/app/admin/(dashboard)/products/upload-actions";
import { setProductThumbnail } from "@/app/admin/(dashboard)/products/actions";

type Props = {
  productId: string;
  /** Current thumbnail URL from the products row, null when absent. */
  currentUrl: string | null;
};

const ACCEPTED_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** Match what UploadDropzone enforces — 8 MB. Anything bigger is
 *  almost certainly not a thumbnail anyway, and lets us reject before
 *  paying for a signed URL + PUT round-trip. */
const MAX_BYTES = 8 * 1024 * 1024;

export default function ThumbnailSwapButton({ productId, currentUrl }: Props) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function flashError(msg: string) {
    setError(msg);
    // Auto-clear so the next click starts from a clean state. 5s is
    // long enough to read a one-line message but short enough that the
    // red border doesn't linger forever after a rare failure.
    setTimeout(() => setError(null), 5000);
  }

  async function handleFile(file: File) {
    // ── client-side preflight ────────────────────────────────
    if (!ACCEPTED_MIMES.has(file.type)) {
      flashError(`unsupported type: ${file.type || "unknown"}`);
      return;
    }
    if (file.size > MAX_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      flashError(`too big: ${mb} MB (max 8 MB)`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // ── 1. mint a signed PUT URL ──────────────────────────
      const ticketRes = await getSignedUploadUrl(
        "thumbnail",
        productId,
        file.name,
        file.type,
      );
      if (!ticketRes.ok) {
        flashError(ticketRes.error);
        return;
      }
      const { signedUrl, ext } = ticketRes.ticket;
      if (!ext) {
        // Should never happen — the server action always sets ext for
        // the "thumbnail" kind. Belt-and-braces in case the contract
        // ever drifts.
        flashError("server didn't return ext");
        return;
      }

      // ── 2. direct-PUT to Storage ──────────────────────────
      // Same wire format as UploadDropzone's putBytes — fetch() with
      // x-upsert so a re-swap overwrites the prior thumbnail in place.
      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "true",
          "cache-control": "max-age=31536000",
        },
        body: file,
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => "");
        flashError(
          `upload failed (${putRes.status}): ${text.slice(0, 80) || putRes.statusText}`,
        );
        return;
      }

      // ── 3. commit to DB ───────────────────────────────────
      const commit = await setProductThumbnail(productId, ext);
      if (!commit.ok) {
        flashError(commit.error);
        return;
      }

      // ── 4. pull the new URL into the row ──────────────────
      router.refresh();
    } catch (err) {
      // Network down / DNS / cors / etc — fetch() throws.
      flashError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      // Clear the input so picking the *same* file twice still fires
      // change. Without this the second click is a silent no-op.
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const tooltip = error
    ? `Last upload failed: ${error}`
    : busy
      ? "Uploading…"
      : currentUrl
        ? "Click to swap thumbnail"
        : "Click to upload thumbnail";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        title={tooltip}
        aria-label={tooltip}
        className={`group relative h-10 w-10 overflow-hidden rounded bg-neutral-100 transition ${
          error
            ? "ring-2 ring-rose-400"
            : "hover:ring-2 hover:ring-sky-400"
        } ${busy ? "cursor-wait" : "cursor-pointer"}`}
      >
        {currentUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={currentUrl}
            alt=""
            className={`h-full w-full object-cover transition ${
              busy ? "opacity-40" : ""
            }`}
          />
        ) : (
          <span
            className={`absolute inset-0 flex items-center justify-center text-[9px] text-neutral-400 ${
              busy ? "opacity-40" : ""
            }`}
          >
            no img
          </span>
        )}

        {/* Hover affordance — only when idle, not while uploading or
            after an error (those have their own visual). */}
        {!busy && !error && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-white opacity-0 transition group-hover:opacity-100"
          >
            <span className="text-sm leading-none">✎</span>
          </span>
        )}

        {/* Spinner during upload. CSS-only — no extra dep. */}
        {busy && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-700" />
          </span>
        )}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleFile(f);
        }}
      />
    </div>
  );
}
