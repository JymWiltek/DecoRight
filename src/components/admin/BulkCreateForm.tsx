"use client";

/**
 * Wave 6 · Commit 4 — bulk-create form orchestrator.
 * Sprint 1 (PART B) — rewired onto the SHARED server path.
 *
 * Each card now carries the FULL single-product upload set (photos +
 * type · glb · fbx/zip · textures · dimensions · category · room) and
 * saves through `createProductFromUpload` — the SAME server action the
 * single-product edit page reaches via updateProduct's shared helpers
 * (buildUploadUpdates / attachStaged* / shouldDispatch*). So the two
 * pages can no longer drift on how an asset is persisted, which is
 * exactly where Wave 9 FBX + Phase A texture handling diverged before.
 *
 * Per card, submit():
 *   1. Mint a productId UUID.
 *   2. Direct-upload every photo / glb / fbx(/zip) / texture via the
 *      existing signed-URL PUT flow (unchanged — this is the proven
 *      bulk byte path).
 *   3. Build a FormData with the SAME field names the single-edit form
 *      emits, then call createProductFromUpload(productId, fd).
 *   4. After all cards succeed, router.push("/admin").
 *
 * Batch capability is preserved: up to 10 cards, each a full product,
 * created in one Save. Failure of any card aborts the whole batch
 * (orphaned storage objects are cheap — same trade-off as before).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import ProductDraftCard, {
  type DraftCardState,
  type TaxoOption,
  defaultPhotoType,
} from "./ProductDraftCard";
import { getSignedUploadUrl } from "@/app/admin/(dashboard)/products/upload-actions";
import { createProductFromUpload } from "@/app/admin/(dashboard)/products/actions";

const MAX_CARDS = 10;

type Props = {
  itemTypeOptions: TaxoOption[];
  roomOptions: TaxoOption[];
  subtypesByItemType: Record<string, TaxoOption[]>;
  /** Mig 0048 — suppliers available to bulk-link (id + name). */
  supplierOptions: { id: string; name: string }[];
};

function newCard(): DraftCardState {
  return {
    cardId: crypto.randomUUID(),
    photos: [],
    photoTypes: [],
    glbFile: null,
    glbBudget: null,
    // Sprint 1 (PART B) — full single-edit parity: FBX original (bare
    // .fbx OR pre-packaged .zip) + loose textures + real dimensions +
    // category (item_type) + room (room_slugs). All optional.
    fbxFile: null,
    fbxIsZip: false,
    textureFiles: [],
    realDimensions: {},
    itemType: null,
    subtypeSlug: null,
    roomSlugs: [],
    supplierIds: [],
  };
}

// PB2 item 1 — bulk create is the one-shot "new product with content" flow.
// A product on DecoRight has no meaning without all four of these, so each
// STARTED card must carry them before the batch can save. Photos are shot,
// the GLB + FBX are generated in Meshy/Rodin, and a retailer (real, or the
// internal "Others" marker) is attached — all in the same session. The rule
// is NEW-only: single-product edit (updateProduct) still edits existing /
// incomplete drafts freely, so nothing is retroactively blocked.

/** Which required assets a card is still missing (empty = complete). */
function missingRequired(c: DraftCardState): string[] {
  const missing: string[] = [];
  if (c.photos.length === 0) missing.push("a photo");
  if (!c.glbFile) missing.push("a 3D model (GLB)");
  if (!c.fbxFile) missing.push("an FBX original");
  if (c.supplierIds.length === 0) missing.push("a retailer");
  return missing;
}

/** A card counts as "started" once the operator touches ANY of the four
 *  required inputs — so a pristine trailing card never blocks the batch,
 *  but a half-filled one does (forcing completion, not silent drop). */
function isStarted(c: DraftCardState): boolean {
  return (
    c.photos.length > 0 ||
    !!c.glbFile ||
    !!c.fbxFile ||
    c.supplierIds.length > 0
  );
}

export default function BulkCreateForm({
  itemTypeOptions,
  roomOptions,
  subtypesByItemType,
  supplierOptions,
}: Props) {
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

  // PB2 item 1 gate. A pristine (untouched) card is ignored so the operator
  // can leave a trailing blank one, but any STARTED card must be COMPLETE —
  // photo + GLB + FBX + retailer — before the batch saves. `submittable` is
  // the set that will actually be created; `blockers` names what's missing on
  // any started-but-incomplete card so the operator gets a per-field message.
  const startedCards = cards.filter(isStarted);
  const submittable = startedCards.filter((c) => missingRequired(c).length === 0);
  const blockers = cards
    .map((c, i) => ({ i, missing: isStarted(c) ? missingRequired(c) : [] }))
    .filter((b) => b.missing.length > 0);

  async function submit() {
    if (blockers.length > 0) {
      setError(
        blockers
          .map((b) => `Product ${b.i + 1}: add ${b.missing.join(", ")}.`)
          .join(" "),
      );
      return;
    }
    if (submittable.length === 0) {
      setError(
        "Each product needs a photo, a 3D model (GLB), an FBX original, and a retailer before saving.",
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      for (let i = 0; i < submittable.length; i++) {
        const card = submittable[i];
        const n = `${i + 1}/${submittable.length}`;
        setProgress(`Uploading product ${n}…`);
        const productId = crypto.randomUUID();
        const fd = new FormData();

        // ── Scalars: category (item_type) + subtype + rooms + dims ──
        if (card.itemType) fd.set("item_type", card.itemType);
        if (card.subtypeSlug) fd.set("subtype_slug", card.subtypeSlug);
        for (const r of card.roomSlugs) fd.append("room_slugs", r);
        const dims = card.realDimensions;
        if (dims.length != null) fd.set("dim_length", String(dims.length));
        if (dims.width != null) fd.set("dim_width", String(dims.width));
        if (dims.height != null) fd.set("dim_height", String(dims.height));
        // Mig 0048 — bulk supplier links: same product_suppliers_json field
        // single-edit emits, with channel defaults (in-stock, no price).
        if (card.supplierIds.length > 0) {
          fd.set(
            "product_suppliers_json",
            JSON.stringify(
              card.supplierIds.map((supplier_id) => ({
                supplier_id,
                price_myr: null,
                stock_status: "in_stock",
                buy_url: null,
                store_address: null,
                is_exclusive: false,
              })),
            ),
          );
        }

        // ── Photos: split into product vs reference, mirroring the
        //    single-edit dropzones (raw_image_entries / real_photo_entries).
        const uploaded = await Promise.all(
          card.photos.map(async (file, idx) => {
            const ticket = await getSignedUploadUrl(
              "raw_image",
              productId,
              file.name,
              file.type,
            );
            if (!ticket.ok) throw new Error(`photo signed URL: ${ticket.error}`);
            await putBytes(ticket.ticket.signedUrl, file);
            const ext =
              ticket.ticket.path.split(".").pop()?.toLowerCase() ?? "jpg";
            return {
              imageId: ticket.ticket.imageId!,
              ext,
              type: card.photoTypes[idx] ?? defaultPhotoType(idx),
            };
          }),
        );
        const rawEntries = uploaded
          .filter((u) => u.type === "product")
          .map(({ imageId, ext }) => ({ imageId, ext }));
        const realEntries = uploaded
          .filter((u) => u.type === "reference")
          .map(({ imageId, ext }) => ({ imageId, ext }));
        if (rawEntries.length) {
          fd.set("raw_image_entries", JSON.stringify(rawEntries));
        }
        if (realEntries.length) {
          fd.set("real_photo_entries", JSON.stringify(realEntries));
        }

        // ── GLB (optional) ──
        if (card.glbFile && card.glbBudget) {
          const ticket = await getSignedUploadUrl(
            "glb",
            productId,
            card.glbFile.name,
            card.glbFile.type || "model/gltf-binary",
          );
          if (!ticket.ok) throw new Error(`GLB signed URL: ${ticket.error}`);
          await putBytes(ticket.ticket.signedUrl, card.glbFile);
          fd.set("glb_path", ticket.ticket.path);
          fd.set("glb_size_kb", String(card.glbBudget.sizeKb));
          fd.set("glb_vertex_count", String(card.glbBudget.vertexCount));
          fd.set("glb_max_texture_dim", String(card.glbBudget.maxTextureDim));
          fd.set("glb_decoded_ram_mb", String(card.glbBudget.decodedRamMb));
        }

        // ── FBX (optional): bare .fbx + loose textures, OR a pre-packaged
        //    .zip. The two are mutually exclusive — the server validates
        //    a zip contains a .fbx and skips packageFbxBundle for it.
        if (card.fbxFile) {
          if (card.fbxIsZip) {
            const ticket = await getSignedUploadUrl(
              "fbx_bundle",
              productId,
              card.fbxFile.name,
              card.fbxFile.type || "application/zip",
            );
            if (!ticket.ok) {
              throw new Error(`FBX zip signed URL: ${ticket.error}`);
            }
            await putBytes(ticket.ticket.signedUrl, card.fbxFile);
            fd.set("fbx_bundle_path", ticket.ticket.path);
            fd.set(
              "fbx_bundle_size_kb",
              String(Math.round(card.fbxFile.size / 1024)),
            );
          } else {
            const ticket = await getSignedUploadUrl(
              "fbx",
              productId,
              card.fbxFile.name,
              card.fbxFile.type || "application/octet-stream",
            );
            if (!ticket.ok) throw new Error(`FBX signed URL: ${ticket.error}`);
            await putBytes(ticket.ticket.signedUrl, card.fbxFile);
            fd.set("fbx_path", ticket.ticket.path);
            fd.set("fbx_size_kb", String(Math.round(card.fbxFile.size / 1024)));

            // Loose texture maps → products/<id>/textures/<name>. The
            // server's shouldDispatchFbxBundle picks up textures_changed
            // and folds them into the zip alongside the .fbx.
            if (card.textureFiles.length) {
              await Promise.all(
                card.textureFiles.map(async (tf) => {
                  const t = await getSignedUploadUrl(
                    "texture",
                    productId,
                    tf.name,
                    tf.type || "application/octet-stream",
                  );
                  if (!t.ok) throw new Error(`texture signed URL: ${t.error}`);
                  await putBytes(t.ticket.signedUrl, tf);
                }),
              );
              fd.set("textures_changed", "1");
            }
          }
        } else if (card.textureFiles.length) {
          // Textures without an FBX make no sense for a new product —
          // surface it instead of silently dropping the uploads.
          throw new Error(
            `Product ${n}: add the .fbx before its texture maps (or clear the textures).`,
          );
        }

        setProgress(`Creating product ${n}…`);
        const res = await createProductFromUpload(productId, fd);
        if (!res.ok) throw new Error(`Product ${n}: ${res.error}`);
      }

      // Push to /admin so the operator sees the freshly-minted drafts.
      // The async tail (AI spec parse + glb compression + fbx bundling)
      // keeps running server-side; refresh in ~30s to see AI-filled fields.
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
            itemTypeOptions={itemTypeOptions}
            roomOptions={roomOptions}
            subtypesByItemType={subtypesByItemType}
            supplierOptions={supplierOptions}
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
          disabled={busy || submittable.length === 0 || blockers.length > 0}
          title={
            blockers.length > 0
              ? blockers
                  .map((b) => `Product ${b.i + 1}: add ${b.missing.join(", ")}`)
                  .join(" · ")
              : undefined
          }
          className={`rounded-md px-4 py-2 text-sm font-medium text-white transition ${
            busy || submittable.length === 0 || blockers.length > 0
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
