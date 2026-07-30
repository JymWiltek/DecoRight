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
import {
  UPLOAD_TRACE_PREFIX,
  newTraceId,
  traceHost,
  classifyRoute,
  classifyError,
  stepBannerSummary,
  stepDetailLine,
  type UploadTraceStep,
} from "@/lib/upload-trace";

const MAX_CARDS = 10;

/** Error carrying the failed trace step, so the top-level catch can render the
 *  precise failing step + raw error instead of a generic message (PB-A). */
class UploadTraceError extends Error {
  step: UploadTraceStep;
  constructor(step: UploadTraceStep) {
    super(step.errorMessage ?? step.note ?? step.label);
    this.name = "UploadTraceError";
    this.step = step;
  }
}

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
  // PB-A diagnostics — the full step trace + expand toggle for the "诊断详情"
  // panel. Populated on every submit (success or failure) so a screenshot on
  // failure carries the raw evidence.
  const [trace, setTrace] = useState<UploadTraceStep[]>([]);
  const [showDetails, setShowDetails] = useState(false);

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
    setShowDetails(false);
    setTrace([]);

    // ── PB-A diagnostics: one traceId for the whole run; every step is timed,
    //    logged to console ([upload-trace]) and collected for the "诊断详情"
    //    panel. NO behavior change — pure instrumentation around the SAME
    //    sign → PUT → create chain.
    const traceId = newTraceId();
    const appHost = typeof window !== "undefined" ? window.location.host : "";
    const steps: UploadTraceStep[] = [];
    const record = (s: UploadTraceStep) => {
      steps.push(s);
      if (s.ok === false) console.error(UPLOAD_TRACE_PREFIX, s);
      else console.log(UPLOAD_TRACE_PREFIX, s);
    };

    // Sign a signed-URL (server action). Distinguishes a network-layer throw
    // (no HTTP status) from a reached-but-rejected {ok:false}.
    const tSign = async (
      kind: Parameters<typeof getSignedUploadUrl>[0],
      label: string,
      productId: string,
      file: File,
    ) => {
      const startMs = Date.now();
      const base: UploadTraceStep = {
        traceId, seq: steps.length + 1, step: `sign:${kind}`, label,
        file: file.name, sizeBytes: file.size, route: "action", startMs,
      };
      let res: Awaited<ReturnType<typeof getSignedUploadUrl>>;
      try {
        res = await getSignedUploadUrl(
          kind, productId, file.name, file.type || "application/octet-stream", traceId,
        );
      } catch (e) {
        const c = classifyError(e);
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          errorName: c.name, errorMessage: c.message,
          note: c.name === "TypeError"
            ? "网络层失败:签名请求(action POST)未到达或未返回,无 HTTP status" : undefined };
        record(s); throw new UploadTraceError(s);
      }
      if (!res.ok) {
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          errorName: "SignRejected", errorMessage: res.error,
          note: "已到达服务端,server action 返回 ok:false(被拒)" };
        record(s); throw new UploadTraceError(s);
      }
      record({ ...base, durationMs: Date.now() - startMs, ok: true });
      return res.ticket;
    };

    // PUT bytes to the signed URL. Captures HTTP status + body, or (on a
    // TypeError with no response) the honest "网络层未收到响应". Records the
    // target host + route (direct-storage vs via-app-api) for the big-file
    // evidence direction.
    const tPut = async (
      label: string, stepKey: string, signedUrl: string, file: File,
    ) => {
      const startMs = Date.now();
      const host = traceHost(signedUrl);
      const route = classifyRoute(host, appHost);
      const base: UploadTraceStep = {
        traceId, seq: steps.length + 1, step: `put:${stepKey}`, label,
        file: file.name, sizeBytes: file.size, targetHost: host, route, startMs,
      };
      let res: Response;
      try {
        res = await fetch(signedUrl, {
          method: "PUT",
          headers: {
            "Content-Type": file.type || "model/gltf-binary",
            "x-upsert": "true",
            "cache-control": "max-age=31536000",
          },
          body: file,
        });
      } catch (e) {
        const c = classifyError(e);
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          errorName: c.name, errorMessage: c.message,
          note: "网络层失败:字节 PUT 未收到响应(TypeError,无 HTTP status)" +
            (route === "via-app-api" ? " · 该路径经自家 API,受 Vercel 4.5MB body 上限" : "") };
        record(s); throw new UploadTraceError(s);
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 400);
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          httpStatus: res.status, responseBody: body, note: `存储返回 HTTP ${res.status}` };
        record(s); throw new UploadTraceError(s);
      }
      record({ ...base, durationMs: Date.now() - startMs, ok: true, httpStatus: res.status });
    };

    // createProductFromUpload (server action). Carries the traceId in the
    // FormData so the server log correlates.
    const tCreate = async (productId: string, fd: FormData) => {
      const startMs = Date.now();
      fd.set("__trace_id", traceId);
      const base: UploadTraceStep = {
        traceId, seq: steps.length + 1, step: "createProduct",
        label: "写入产品记录(server action)", route: "action", startMs,
      };
      let res: Awaited<ReturnType<typeof createProductFromUpload>>;
      try {
        res = await createProductFromUpload(productId, fd);
      } catch (e) {
        const c = classifyError(e);
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          errorName: c.name, errorMessage: c.message,
          note: c.name === "TypeError"
            ? "网络层失败:写库 action POST 未到达或未返回,无 HTTP status" : undefined };
        record(s); throw new UploadTraceError(s);
      }
      if (!res.ok) {
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          errorName: "CreateRejected", errorMessage: res.error, note: "已到达服务端,被拒" };
        record(s); throw new UploadTraceError(s);
      }
      record({ ...base, durationMs: Date.now() - startMs, ok: true });
    };

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
            const ticket = await tSign(
              "raw_image", `请求图片签名 URL:${file.name}`, productId, file,
            );
            await tPut(`上传图片 ${file.name} 到存储`, "raw_image", ticket.signedUrl, file);
            const ext = ticket.path.split(".").pop()?.toLowerCase() ?? "jpg";
            return {
              imageId: ticket.imageId!,
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
          const ticket = await tSign(
            "glb", `请求 GLB 签名 URL:${card.glbFile.name}`, productId, card.glbFile,
          );
          await tPut(`上传 ${card.glbFile.name} 到存储`, "glb", ticket.signedUrl, card.glbFile);
          fd.set("glb_path", ticket.path);
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
            const ticket = await tSign(
              "fbx_bundle", `请求 FBX zip 签名 URL:${card.fbxFile.name}`, productId, card.fbxFile,
            );
            await tPut(`上传 ${card.fbxFile.name}(zip)到存储`, "fbx_bundle", ticket.signedUrl, card.fbxFile);
            fd.set("fbx_bundle_path", ticket.path);
            fd.set(
              "fbx_bundle_size_kb",
              String(Math.round(card.fbxFile.size / 1024)),
            );
          } else {
            const ticket = await tSign(
              "fbx", `请求 FBX 签名 URL:${card.fbxFile.name}`, productId, card.fbxFile,
            );
            await tPut(`上传 ${card.fbxFile.name} 到存储`, "fbx", ticket.signedUrl, card.fbxFile);
            fd.set("fbx_path", ticket.path);
            fd.set("fbx_size_kb", String(Math.round(card.fbxFile.size / 1024)));

            // Loose texture maps → products/<id>/textures/<name>. The
            // server's shouldDispatchFbxBundle picks up textures_changed
            // and folds them into the zip alongside the .fbx.
            if (card.textureFiles.length) {
              await Promise.all(
                card.textureFiles.map(async (tf) => {
                  const t = await tSign(
                    "texture", `请求贴图签名 URL:${tf.name}`, productId, tf,
                  );
                  await tPut(`上传贴图 ${tf.name} 到存储`, "texture", t.signedUrl, tf);
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
        await tCreate(productId, fd);
      }

      // Push to /admin so the operator sees the freshly-minted drafts.
      // The async tail (AI spec parse + glb compression + fbx bundling)
      // keeps running server-side; refresh in ~30s to see AI-filled fields.
      setTrace(steps);
      router.push("/admin");
    } catch (e) {
      // PB-A — NO MORE guessing (the #34 "页面可能已过期" copy was a guess,
      // and it was wrong: "Failed to fetch" recurs on a freshly-reloaded page,
      // which rules out both session expiry AND stale deploy). Show the EXACT
      // failed step + raw error; the collected steps drive the "诊断详情"
      // panel so a screenshot is enough evidence. State (files/fields) is NOT
      // cleared. The #34 DeployStaleBanner mechanism is untouched (it lives on
      // the page, not here).
      setTrace(steps);
      const failed =
        e instanceof UploadTraceError
          ? e.step
          : (steps.find((s) => s.ok === false) ?? null);
      if (failed) {
        setError(stepBannerSummary(failed));
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
      setShowDetails(steps.length > 0);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-medium">{error}</div>
          {trace.length > 0 && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className="text-xs underline underline-offset-2 hover:text-rose-900"
              >
                {showDetails ? "收起诊断详情" : "展开诊断详情"}({trace.length} 步)
              </button>
              <button
                type="button"
                onClick={() => {
                  const text = trace.map(stepDetailLine).join("\n");
                  void navigator.clipboard?.writeText(text).catch(() => {});
                }}
                className="ml-3 text-xs underline underline-offset-2 hover:text-rose-900"
              >
                复制
              </button>
              {showDetails && (
                <pre
                  data-testid="upload-trace-panel"
                  className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-rose-200 bg-white/70 p-2 text-[11px] leading-relaxed text-neutral-700"
                >
                  {`trace: ${trace[0]?.traceId ?? "?"}\n`}
                  {trace.map((s) => stepDetailLine(s)).join("\n")}
                </pre>
              )}
            </div>
          )}
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

