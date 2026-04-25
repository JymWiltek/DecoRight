/**
 * Meshy v1 multi-image-to-3D API client. Phase A · Milestone 2.
 *
 * Docs: https://docs.meshy.ai/api/multi-image-to-3d
 *
 * Three calls, in order:
 *
 *   1. createMeshyTask({ imageUrls, productId })
 *      POST /openapi/v1/multi-image-to-3d
 *      Submits 1-4 image URLs, gets back a `task_id` immediately.
 *      Reserves one `meshy` quota slot via reserveSlot() (cost
 *      sourced from app_config.meshy_cost_per_job_usd; bills
 *      ok / refunds on POST failure).
 *
 *   2. getMeshyTask(taskId)
 *      GET /openapi/v1/multi-image-to-3d/:id
 *      Returns the task's current status + (when SUCCEEDED)
 *      `model_urls.glb`. Free — Meshy doesn't bill polling.
 *      Phase A's polling worker (Milestone 3) calls this in a loop.
 *
 *   3. downloadMeshyGlb(modelUrl)
 *      GET on the signed URL Meshy returned in model_urls.glb.
 *      Returns raw bytes. The signed URL is short-lived (Meshy
 *      sets `Expires=…` ~1h out per assets.meshy.ai), so the
 *      worker downloads + reuploads to our `models` bucket
 *      immediately after the task hits SUCCEEDED.
 *
 * What this module does NOT do:
 *   - Touch the database. Callers (Publish action, polling worker)
 *     own product_id ↔ task_id state and write the GLB URL.
 *   - Upload to Storage. That's storage.ts's job.
 *   - Decide WHEN to retry. The retry-up-to-3 rule lives in the
 *     polling worker (Milestone 3); we just expose a clean
 *     "create / poll / download" API that's easy to call.
 *
 * Test mode:
 *   Meshy ships a public test API key (msy_dummy_api_key_for_test_
 *   mode_12345678). When MESHY_API_KEY is set to that value, Meshy
 *   returns a fake task that resolves to a sample GLB in a few
 *   seconds — no real money spent. This module behaves identically
 *   either way; the test key is just another valid bearer token.
 *
 * Error shape:
 *   - MeshyNotConfiguredError → `MESHY_API_KEY` env var missing.
 *     Caller should treat this as "feature disabled" (same pattern
 *     as RemBgProviderUnavailableError in src/lib/rembg/types.ts).
 *   - MeshyApiError → 4xx/5xx from Meshy with the response body.
 *   - QuotaExceededError → bubbles up from reserveSlot() when
 *     today's meshy_daily_limit (default 20) is hit or the global
 *     emergency_stop is on.
 *   - Plain Error → network / parse failures.
 */

import {
  QuotaExceededError,
  reserveSlot,
  billSlot,
  refundSlot,
} from "@/lib/api-usage";

// ── endpoints ─────────────────────────────────────────────
// Hard-coded base — Meshy's API URL is stable and we'd rather a
// typo here be a 1-line PR than an env-var landmine.
const MESHY_BASE = "https://api.meshy.ai/openapi/v1";
const MULTI_ENDPOINT = `${MESHY_BASE}/multi-image-to-3d`;

// ── error types ───────────────────────────────────────────

/**
 * MESHY_API_KEY env var is missing/empty. Distinct from "Meshy
 * said no" so the caller can degrade gracefully (e.g. Publish
 * falls back to "manual GLB only" mode in dev environments
 * without the key set).
 */
export class MeshyNotConfiguredError extends Error {
  constructor() {
    super("MESHY_API_KEY is not set");
    this.name = "MeshyNotConfiguredError";
  }
}

/**
 * Meshy returned a non-2xx. `status` is the HTTP code, `body` is
 * up to 500 chars of the response payload (for the operator-facing
 * meshy_error column).
 */
export class MeshyApiError extends Error {
  constructor(
    public httpStatus: number,
    public body: string,
    label: string,
  ) {
    super(`${label}: HTTP ${httpStatus} — ${body.slice(0, 300)}`);
    this.name = "MeshyApiError";
  }
}

// ── public types ──────────────────────────────────────────

/** Exact strings Meshy returns. Casing matters — don't lowercase. */
export type MeshyTaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

/**
 * `latest` resolves server-side to whatever the current default is
 * (Meshy 6 today, per docs). We pin to `latest` for Phase A so we
 * don't have to ship a code change every time Meshy promotes a new
 * default model — quality drift on rev'd models is a Phase B
 * problem.
 */
export type MeshyAiModel = "meshy-5" | "meshy-6" | "latest";

export type CreateMeshyTaskInput = {
  /**
   * 1-4 publicly-fetchable image URLs. Meshy's servers download
   * each one — they MUST be reachable from the public internet
   * (signed/public Storage URLs are fine, our private raw_images
   * bucket is not). Caller is responsible for producing public URLs.
   */
  imageUrls: string[];
  /**
   * Optional. Stamped onto the api_usage row so the admin spend
   * page can attribute cost to the product that triggered it.
   */
  productId?: string;
  /** Default 'latest'. */
  aiModel?: MeshyAiModel;
  /**
   * Default true. Without textures the GLB is a grey untextured
   * mesh — useful for quick checks but never what we ship. Phase A
   * always wants textured.
   */
  shouldTexture?: boolean;
  /**
   * Default true. PBR (physically-based rendering) materials look
   * dramatically better in <model-viewer>. Adds no extra cost per
   * Meshy's pricing model.
   */
  enablePbr?: boolean;
  /**
   * Default ['glb']. We only ever consume GLB on the front-end, so
   * asking Meshy for fbx/obj/etc. is wasted compute on their side
   * and wasted bandwidth on the download. Override only for the
   * rare ops case (e.g. one-off DCC export).
   */
  targetFormats?: Array<"glb" | "obj" | "fbx" | "stl" | "usdz" | "3mf">;
};

export type CreateMeshyTaskResult = {
  /** Meshy's task id — store this in products.meshy_task_id. */
  taskId: string;
  /** What the api_usage row was billed at. */
  costUsd: number;
};

/**
 * Normalized (camelCase) shape of a Meshy task. Mirrors the
 * subset of fields the polling worker + admin UI care about; we
 * intentionally drop everything else so a Meshy schema bump doesn't
 * tear through callers.
 */
export type MeshyTask = {
  id: string;
  status: MeshyTaskStatus;
  /** 0-100 */
  progress: number;
  /** Only `glb` is populated on Phase A; others present iff caller
   *  passed targetFormats with extras. All are short-lived signed
   *  URLs — download immediately, don't store. */
  modelUrls: {
    glb?: string;
    fbx?: string;
    obj?: string;
    usdz?: string;
    stl?: string;
  };
  /** Meshy-hosted thumbnail of the generated model. We don't use
   *  it for product cards (those keep our own thumbnails) but
   *  surface it in the admin for QA. */
  thumbnailUrl?: string;
  /** Unix timestamp (ms) — pass-through from Meshy. */
  createdAt?: number;
  startedAt?: number;
  finishedAt?: number;
  /** Populated when status='FAILED'. Goes into products.meshy_error. */
  taskError?: { message: string };
};

// ── helpers ───────────────────────────────────────────────

export function isMeshyConfigured(): boolean {
  return Boolean(process.env.MESHY_API_KEY);
}

function bearer(): string {
  const key = process.env.MESHY_API_KEY;
  if (!key) throw new MeshyNotConfiguredError();
  return `Bearer ${key}`;
}

// ── 1. createMeshyTask ────────────────────────────────────

/**
 * Submit a multi-image-to-3D job. Returns the `task_id` that the
 * polling worker will hand to getMeshyTask().
 *
 * Quota: reserves one `meshy` slot BEFORE the POST. On HTTP 2xx
 * we bill('ok'); on 4xx/5xx (or any thrown error) we refund so the
 * cap math self-heals.
 *
 * Why bill on task creation rather than on SUCCEEDED:
 *   Meshy starts spending compute the moment they accept the
 *   POST. Even if the task later FAILEDs we already paid (their
 *   pricing is per-task-created, not per-task-completed). The
 *   audit row reflects that reality.
 */
export async function createMeshyTask(
  input: CreateMeshyTaskInput,
): Promise<CreateMeshyTaskResult> {
  if (!isMeshyConfigured()) throw new MeshyNotConfiguredError();

  // ── input validation ─────────────────────────────────
  // Meshy enforces 1-4 server-side; checking client-side just
  // gives a friendlier error and avoids burning a quota slot on
  // an obviously-bad request.
  const urls = input.imageUrls ?? [];
  if (urls.length < 1 || urls.length > 4) {
    throw new Error(
      `meshy: imageUrls must be 1-4 entries, got ${urls.length}`,
    );
  }
  for (const u of urls) {
    if (typeof u !== "string" || !/^https?:\/\//i.test(u)) {
      throw new Error(`meshy: image url is not http(s): ${String(u).slice(0, 120)}`);
    }
  }

  // ── reserve quota ────────────────────────────────────
  const reservation = await reserveSlot({
    service: "meshy",
    productId: input.productId ?? null,
    note: `meshy create: ${urls.length} img${urls.length === 1 ? "" : "s"}`,
  });

  // ── build body ───────────────────────────────────────
  // Meshy uses snake_case; we accept camelCase from callers and
  // translate here. Defaults are inlined so the wire payload
  // doesn't depend on Meshy's server-side defaults drifting.
  const body = {
    image_urls: urls,
    ai_model: input.aiModel ?? "latest",
    should_texture: input.shouldTexture ?? true,
    enable_pbr: input.enablePbr ?? true,
    target_formats: input.targetFormats ?? ["glb"],
  };

  try {
    const res = await fetch(MULTI_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: bearer(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new MeshyApiError(res.status, text, "meshy create");
    }

    // Meshy returns { result: "<task_id>" } on success. Defensive
    // parse: tolerate either { result } or { id } in case Meshy
    // ever standardises on the GET-shape's `id` field.
    const json = (await res.json()) as { result?: string; id?: string };
    const taskId = json.result ?? json.id;
    if (!taskId || typeof taskId !== "string") {
      throw new Error(
        `meshy create: response missing task id (got ${JSON.stringify(json).slice(0, 200)})`,
      );
    }

    await billSlot(reservation.usageId, "ok", `task=${taskId}`);
    return { taskId, costUsd: reservation.costUsd };
  } catch (err) {
    // QuotaExceededError shouldn't reach here (it throws inside
    // reserveSlot before we get here), but guard anyway.
    if (err instanceof QuotaExceededError) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    // Best-effort refund — if the refund itself fails (DB hiccup),
    // we'd rather surface the original error than mask it.
    await refundSlot(reservation, "meshy", reason).catch(() => {});
    throw err;
  }
}

// ── 2. getMeshyTask ───────────────────────────────────────

/**
 * Fetch a task's current state. No quota cost (Meshy doesn't bill
 * GET).
 *
 * Always returns a normalized MeshyTask; throws on HTTP errors or
 * if the response is malformed beyond recognition.
 */
export async function getMeshyTask(taskId: string): Promise<MeshyTask> {
  if (!isMeshyConfigured()) throw new MeshyNotConfiguredError();
  if (!taskId || typeof taskId !== "string") {
    throw new Error(`meshy get: invalid taskId`);
  }

  const res = await fetch(`${MULTI_ENDPOINT}/${encodeURIComponent(taskId)}`, {
    method: "GET",
    headers: { Authorization: bearer() },
    // No body, no caching — task state changes minute by minute.
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MeshyApiError(res.status, text, `meshy get ${taskId}`);
  }

  const raw = (await res.json()) as Record<string, unknown>;
  return normalizeTask(raw);
}

/**
 * Convert Meshy's snake_case payload into our camelCase shape +
 * narrow the status string. Defensive: missing fields default to
 * sensible blanks so the caller doesn't get hit by `undefined.foo`.
 */
function normalizeTask(raw: Record<string, unknown>): MeshyTask {
  const status = raw.status;
  const allowed: MeshyTaskStatus[] = [
    "PENDING",
    "IN_PROGRESS",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
  ];
  const safeStatus = (allowed as string[]).includes(status as string)
    ? (status as MeshyTaskStatus)
    : // Unknown status: treat as PENDING so the worker keeps polling
      // rather than wedging on a string it doesn't recognise. Logged
      // by the caller via the raw payload if needed.
      "PENDING";

  const modelUrlsRaw = (raw.model_urls ?? {}) as Record<string, unknown>;
  const modelUrls: MeshyTask["modelUrls"] = {};
  for (const k of ["glb", "fbx", "obj", "usdz", "stl"] as const) {
    const v = modelUrlsRaw[k];
    if (typeof v === "string" && v.length > 0) modelUrls[k] = v;
  }

  const taskErrorRaw = raw.task_error as { message?: unknown } | undefined;
  const taskError =
    taskErrorRaw && typeof taskErrorRaw.message === "string"
      ? { message: taskErrorRaw.message }
      : undefined;

  return {
    id: String(raw.id ?? ""),
    status: safeStatus,
    progress: typeof raw.progress === "number" ? raw.progress : 0,
    modelUrls,
    thumbnailUrl:
      typeof raw.thumbnail_url === "string" ? raw.thumbnail_url : undefined,
    createdAt: typeof raw.created_at === "number" ? raw.created_at : undefined,
    startedAt: typeof raw.started_at === "number" ? raw.started_at : undefined,
    finishedAt:
      typeof raw.finished_at === "number" ? raw.finished_at : undefined,
    taskError,
  };
}

// ── 3. downloadMeshyGlb ───────────────────────────────────

/**
 * Pull bytes from a Meshy-hosted signed URL. The URL is the same
 * string Meshy put in `model_urls.glb` — it includes its own
 * `Expires=…` query param (typically ~1h out), so the worker should
 * call this immediately after the task hits SUCCEEDED, then upload
 * the bytes to our `models` bucket.
 *
 * No quota cost — bandwidth from Meshy's CDN is on Meshy.
 *
 * Why we don't pass through the bearer token here: the URL is
 * already signed, no auth header needed (and Meshy's CDN actually
 * rejects requests that include both).
 */
export async function downloadMeshyGlb(
  modelUrl: string,
): Promise<{ bytes: Uint8Array; sizeBytes: number }> {
  if (!modelUrl || typeof modelUrl !== "string") {
    throw new Error("meshy download: empty modelUrl");
  }

  const res = await fetch(modelUrl, { method: "GET" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new MeshyApiError(res.status, text, "meshy download glb");
  }

  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);

  // Sanity: a real GLB starts with the 4-byte magic "glTF". If
  // Meshy ever returns an HTML error page disguised as 200 (rare
  // but seen on CDN edge-cases), this check catches it before the
  // caller uploads garbage to Storage.
  if (
    bytes.length < 4 ||
    bytes[0] !== 0x67 || // 'g'
    bytes[1] !== 0x6c || // 'l'
    bytes[2] !== 0x54 || // 'T'
    bytes[3] !== 0x46 //   'F'
  ) {
    throw new Error(
      `meshy download glb: response is not a GLB (got ${bytes.length} bytes, magic=${Array.from(bytes.slice(0, 4)).map((b) => b.toString(16)).join("")})`,
    );
  }

  return { bytes, sizeBytes: bytes.length };
}
