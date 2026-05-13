"use client";

/**
 * Wave 6 · Commit 4 — bulk-create form orchestrator.
 *
 * Holds the array of cards, the "+ Add another product" / "Save all"
 * controls, and the upload-then-create state machine. The actual
 * upload + bulkCreateProducts call run in `submit()`:
 *
 *   1. Mint a productId UUID per card.
 *   2. Concurrently upload every photo + GLB via signed-URL PUTs
 *      (existing direct-upload flow — same getSignedUploadUrl as the
 *      single-product dropzones).
 *   3. Call bulkCreateProducts(drafts) with the URLs we just minted.
 *   4. router.push("/admin") on success — list page will show the
 *      new drafts; AI fill arrives in the background within ~30s.
 *
 * Failure modes (all surfaced as a banner above the cards):
 *   • Signed-URL mint fails       → bail before any upload
 *   • PUT bytes fails             → bail; retried by clicking Save again
 *   • bulkCreateProducts({error}) → show the server's reason
 *
 * No partial-success: if anything fails the whole batch is aborted.
 * Storage objects already PUT remain orphaned — same trade-off as
 * the single-product save path. The bulk page's value is rapid
 * scanning, not transactional reliability; orphans are cheap.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProductDraftCard, {
  type DraftCardState,
  defaultPhotoType,
} from "./ProductDraftCard";
import { getSignedUploadUrl } from "@/app/admin/(dashboard)/products/upload-actions";
import {
  bulkCreateProducts,
  type BulkCreateDraft,
} from "@/app/admin/(dashboard)/products/actions";

const MAX_CARDS = 10;

function newCard(): DraftCardState {
  return {
    cardId: crypto.randomUUID(),
    photos: [],
    photoTypes: [],
    glbFile: null,
    glbBudget: null,
  };
}

export default function BulkCreateForm() {
  const router = useRouter();
  const [cards, setCards] = useState<DraftCardState[]>(() => [newCard()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  function addCard() {
    if (cards.length >= MAX_CARDS) return;
    setCards((cs) => [...cs, newCard()]);
  }

  function deleteCard(i: number) {
    setCards((cs) => (cs.length === 1 ? cs : cs.filter((_, j) => j !== i)));
  }

  function updateCard(i: number, next: DraftCardState) {
    setCards((cs) => cs.map((c, j) => (j === i ? next : c)));
  }

  // Cards with at least 1 photo are submittable; empty cards are
  // ignored. Operator can leave a half-finished card in the list and
  // still save the others — matches Gmail draft semantics.
  const submittable = cards.filter((c) => c.photos.length > 0);

  async function submit() {
    if (submittable.length === 0) {
      setError("Add at least one photo to a card before saving.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const drafts: BulkCreateDraft[] = [];

      for (let i = 0; i < submittable.length; i++) {
        const card = submittable[i];
        setProgress(`Uploading product ${i + 1}/${submittable.length}…`);
        const productId = crypto.randomUUID();

        // Photos: parallel within a card. Each photo carries its
        // operator-picked `type` so the server action can decide
        // image_kind + show_on_storefront + whether to fire rembg.
        const imageEntries = await Promise.all(
          card.photos.map(async (file, idx) => {
            const ticket = await getSignedUploadUrl(
              "raw_image",
              productId,
              file.name,
              file.type,
            );
            if (!ticket.ok) {
              throw new Error(`signed URL: ${ticket.error}`);
            }
            await putBytes(ticket.ticket.signedUrl, file);
            const ext =
              ticket.ticket.path.split(".").pop()?.toLowerCase() ?? "jpg";
            const type =
              card.photoTypes[idx] ?? defaultPhotoType(idx);
            return {
              imageId: ticket.ticket.imageId!,
              ext,
              type,
            };
          }),
        );

        // GLB (optional)
        let glbMeta: BulkCreateDraft["glb"] = null;
        if (card.glbFile && card.glbBudget) {
          const ticket = await getSignedUploadUrl(
            "glb",
            productId,
            card.glbFile.name,
            card.glbFile.type || "model/gltf-binary",
          );
          if (!ticket.ok) {
            throw new Error(`GLB signed URL: ${ticket.error}`);
          }
          await putBytes(ticket.ticket.signedUrl, card.glbFile);
          glbMeta = {
            sizeKb: card.glbBudget.sizeKb,
            vertexCount: card.glbBudget.vertexCount,
            maxTextureDim: card.glbBudget.maxTextureDim,
            decodedRamMb: card.glbBudget.decodedRamMb,
          };
        }

        drafts.push({ productId, images: imageEntries, glb: glbMeta });
      }

      setProgress(
        `Creating ${drafts.length} product${drafts.length === 1 ? "" : "s"}…`,
      );
      const res = await bulkCreateProducts(drafts);
      if (!res.ok) {
        throw new Error(res.error);
      }

      // Push to /admin so the operator sees the freshly-minted drafts.
      // The async tail (rembg + AI parse) keeps running on the server;
      // the operator can refresh in ~30s to see the AI-filled fields.
      router.push("/admin");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      )}
      {progress && (
        <div className="mb-4 rounded-md bg-sky-50 px-4 py-2 text-sm text-sky-700">
          {progress}
        </div>
      )}

      <div className="space-y-4">
        {cards.map((c, i) => (
          <ProductDraftCard
            key={c.cardId}
            index={i}
            state={c}
            busy={busy}
            canDelete={cards.length > 1}
            onChange={(next) => updateCard(i, next)}
            onDelete={() => deleteCard(i)}
          />
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={addCard}
          disabled={busy || cards.length >= MAX_CARDS}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add another product ({cards.length}/{MAX_CARDS})
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || submittable.length === 0}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white transition ${
            busy || submittable.length === 0
              ? "bg-neutral-400 cursor-not-allowed"
              : "bg-black hover:bg-neutral-800"
          }`}
        >
          {busy
            ? "Saving…"
            : `Save all & create ${submittable.length} draft${submittable.length === 1 ? "" : "s"}`}
        </button>
      </div>
    </div>
  );
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
    throw new Error(`upload failed (${res.status}): ${text || res.statusText}`);
  }
}
