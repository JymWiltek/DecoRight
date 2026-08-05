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

import { useRef, useState } from "react";
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
  putWithNetworkRetry,
  putRetryExhaustedNote,
  type UploadTraceStep,
} from "@/lib/upload-trace";
import { probeStorageReachable } from "@/lib/admin/storage-probe";
import {
  initCardUpload,
  countPendingFiles,
  buildCardFd,
  type CardUpload,
} from "@/lib/admin/bulk-upload-state";
import StorageStatusBanner from "./StorageStatusBanner";

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
  // Per-card upload progress (survives partial failure) + the cards whose files
  // died, driving the "重传失败的 N 个文件" button. The ref holds the mutable
  // working state; failedCardIds is the render-visible summary.
  const uploadsRef = useRef<Map<string, CardUpload>>(new Map());
  const [failedCardIds, setFailedCardIds] = useState<string[]>([]);

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
    // Fresh batch — reset per-card upload progress + trace.
    uploadsRef.current.clear();
    setFailedCardIds([]);
    setTrace([]);
    await runUpload(submittable);
  }

  /** Re-run ONLY the cards whose files died — reusing each card's productId and
   *  skipping its already-uploaded files (the one-click 重传失败的文件 path). */
  async function refill() {
    const failedCards = submittable.filter((c) =>
      failedCardIds.includes(c.cardId),
    );
    if (failedCards.length === 0) return;
    await runUpload(failedCards);
  }

  async function runUpload(cardsToProcess: DraftCardState[]) {
    setError(null);
    setBusy(true);
    setShowDetails(false);

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
      // ONE PUT attempt, classified for the retry decision. A rejected
      // fetch (TypeError / no response) → "network-error" (retry-able);
      // an HTTP 4xx/5xx → "http-error" (structural, never retried). The
      // signed URL is reused across retries — they fire within seconds,
      // well inside the ~2 h token validity, so no re-sign is needed.
      const attempt = async () => {
        try {
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
            const body = (await res.text().catch(() => "")).slice(0, 400);
            return { kind: "http-error" as const, status: res.status, body };
          }
          return { kind: "ok" as const, status: res.status };
        } catch (e) {
          return { kind: "network-error" as const, error: e };
        }
      };

      // Pass the storage probe so the final retry waits for connectivity to
      // return instead of firing into an ongoing outage (see putWithNetworkRetry).
      const { result, retries, gaveUpWaiting } = await putWithNetworkRetry(
        attempt,
        { probe: probeStorageReachable },
      );

      if (result.kind === "network-error") {
        const c = classifyError(result.error);
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          retries, errorName: c.name, errorMessage: c.message,
          note: gaveUpWaiting
            ? "网络层失败:等待存储恢复超时,失败文件已保留 —— 请点「重传失败的文件」"
            : putRetryExhaustedNote(route === "via-app-api") };
        record(s); throw new UploadTraceError(s);
      }
      if (result.kind === "http-error") {
        const s: UploadTraceStep = { ...base, durationMs: Date.now() - startMs, ok: false,
          retries: retries || undefined,
          httpStatus: result.status, responseBody: result.body,
          note: `存储返回 HTTP ${result.status}` };
        record(s); throw new UploadTraceError(s);
      }
      record({ ...base, durationMs: Date.now() - startMs, ok: true,
        retries: retries || undefined, httpStatus: result.status });
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

    // Upload every not-yet-done file in a card, updating `up` in place. Throws
    // on the first failure; the per-card catch below keeps the batch going and
    // preserves what already succeeded, so a refill re-sends only the dead files.
    const uploadCardFiles = async (card: DraftCardState, up: CardUpload) => {
      for (let idx = 0; idx < card.photos.length; idx++) {
        if (up.photos[idx]) continue; // already uploaded — skip on refill
        const file = card.photos[idx];
        const ticket = await tSign(
          "raw_image", `请求图片签名 URL:${file.name}`, up.productId, file,
        );
        await tPut(`上传图片 ${file.name} 到存储`, "raw_image", ticket.signedUrl, file);
        const ext = ticket.path.split(".").pop()?.toLowerCase() ?? "jpg";
        up.photos[idx] = {
          imageId: ticket.imageId!,
          ext,
          type: card.photoTypes[idx] ?? defaultPhotoType(idx),
        };
      }

      if (card.glbFile && card.glbBudget && !up.glbPath) {
        const ticket = await tSign(
          "glb", `请求 GLB 签名 URL:${card.glbFile.name}`, up.productId, card.glbFile,
        );
        await tPut(`上传 ${card.glbFile.name} 到存储`, "glb", ticket.signedUrl, card.glbFile);
        up.glbPath = ticket.path;
      }

      // FBX (optional): bare .fbx + loose textures, OR a pre-packaged .zip.
      if (card.fbxFile && !up.fbxPath) {
        const kind: "fbx_bundle" | "fbx" = card.fbxIsZip ? "fbx_bundle" : "fbx";
        const signLabel = card.fbxIsZip
          ? `请求 FBX zip 签名 URL:${card.fbxFile.name}`
          : `请求 FBX 签名 URL:${card.fbxFile.name}`;
        const putLabel = card.fbxIsZip
          ? `上传 ${card.fbxFile.name}(zip)到存储`
          : `上传 ${card.fbxFile.name} 到存储`;
        const ticket = await tSign(kind, signLabel, up.productId, card.fbxFile);
        await tPut(putLabel, kind, ticket.signedUrl, card.fbxFile);
        up.fbxPath = ticket.path;
      } else if (!card.fbxFile && card.textureFiles.length) {
        // Textures without an FBX make no sense — surface it (caught per-card).
        throw new Error("add the .fbx before its texture maps (or clear the textures).");
      }

      // Loose texture maps (bare-fbx path only) → products/<id>/textures/<name>.
      if (card.fbxFile && !card.fbxIsZip) {
        for (let idx = 0; idx < card.textureFiles.length; idx++) {
          if (up.textures[idx]) continue;
          const tf = card.textureFiles[idx];
          const t = await tSign("texture", `请求贴图签名 URL:${tf.name}`, up.productId, tf);
          await tPut(`上传贴图 ${tf.name} 到存储`, "texture", t.signedUrl, tf);
          up.textures[idx] = true;
        }
      }
    };

    // Per-card, FAILURE-TOLERANT: one card's dead file no longer aborts the
    // whole batch. Successful cards are created; a failed card keeps its files +
    // productId so refill() re-sends ONLY its dead files and completes the SAME
    // row (no duplicate). Files/fields are never cleared on failure.
    let firstFailStep: UploadTraceStep | null = null;
    let firstFailMsg: string | null = null;
    try {
      for (let i = 0; i < cardsToProcess.length; i++) {
        const card = cardsToProcess[i];
        const n = `${i + 1}/${cardsToProcess.length}`;
        setProgress(`Uploading product ${n}…`);
        let up = uploadsRef.current.get(card.cardId);
        if (!up) {
          up = initCardUpload(card);
          uploadsRef.current.set(card.cardId, up);
        }
        try {
          await uploadCardFiles(card, up);
          setProgress(`Creating product ${n}…`);
          await tCreate(up.productId, buildCardFd(card, up));
          up.status = "done";
        } catch (e) {
          up.status = "failed";
          if (e instanceof UploadTraceError) {
            if (!firstFailStep) firstFailStep = e.step;
          } else if (e instanceof Error && !firstFailMsg) {
            firstFailMsg = e.message;
          }
        }
      }
    } finally {
      // APPEND the trace so a refill's resign+retry shows alongside the original
      // failure. The #34 DeployStaleBanner mechanism (on the page) is untouched.
      setTrace((prev) => [...prev, ...steps]);
      setBusy(false);
      setProgress(null);
    }

    // Which submittable cards are STILL failed (a refill clears the recovered).
    const stillFailed = submittable
      .filter((c) => uploadsRef.current.get(c.cardId)?.status === "failed")
      .map((c) => c.cardId);
    setFailedCardIds(stillFailed);
    if (stillFailed.length === 0) {
      // Every started product is now created (across the initial run + refills).
      // The async tail (AI spec parse + glb compression + fbx bundling) keeps
      // running server-side; the list refreshes in ~30s with AI-filled fields.
      router.push("/admin");
    } else {
      setError(
        firstFailStep
          ? stepBannerSummary(firstFailStep)
          : firstFailMsg ?? "部分产品的文件上传失败,请点「重传失败的文件」。",
      );
      setShowDetails(steps.length > 0);
    }
  }

  // How many dead files across the still-failed cards — the "N" in the button.
  const failedFileCount = failedCardIds.reduce((sum, id) => {
    const card = cards.find((c) => c.cardId === id);
    const up = uploadsRef.current.get(id);
    return sum + (card && up ? countPendingFiles(card, up) : 0);
  }, 0);

  return (
    <div>
      <StorageStatusBanner />
      {error && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-medium">{error}</div>
          {failedCardIds.length > 0 && (
            <button
              type="button"
              onClick={refill}
              disabled={busy}
              className="mt-2 rounded-md border border-rose-400 bg-white px-3 py-1.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
            >
              {busy
                ? "重传中…"
                : `重传失败的 ${failedFileCount} 个文件（${failedCardIds.length} 个产品）`}
            </button>
          )}
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

