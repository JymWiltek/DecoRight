// @ts-nocheck — this file targets Deno; the Node-flavored TS server
// in the IDE doesn't have Deno globals (Deno.env, std/http) or the
// `npm:` specifier resolution. Disabling typecheck here keeps the
// repo's `tsc --noEmit` clean (which targets Node) while letting the
// Deno deploy runtime resolve everything natively. The testable
// logic lives in worker.ts (pure TS, fully typechecked).

/**
 * Phase A · Milestone 3 · Commit 5 — Meshy polling worker (Deno
 * edge function entry).
 *
 * One HTTP handler:
 *
 *   POST /functions/v1/poll-meshy
 *   X-Cron-Secret: <shared with the cron job>
 *
 * Wires real Supabase Storage / Postgres + native fetch into the
 * pure worker in ./worker.ts and runs one tick. Returns a JSON
 * summary so the operator can curl this manually for debugging:
 *
 *   { "scanned": 3, "outcomes": [...] }
 *
 * ─── Why a custom shared-secret instead of JWT verification ───
 *
 * Supabase Edge Functions verify the `Authorization: Bearer <jwt>`
 * header by default. To call from pg_cron via net.http_post we'd
 * either have to (a) ship a service-role key into the cron config
 * (bad: rotation pain, blast radius) or (b) deploy with
 * `--no-verify-jwt` and gate ourselves. We pick (b):
 *
 *   - Deploy:  supabase functions deploy poll-meshy --no-verify-jwt
 *   - Secret:  supabase secrets set CRON_SECRET=<random>
 *               (and store the same value as a Postgres setting
 *                so cron.schedule can read it — Commit 6)
 *   - Header:  the cron job sets X-Cron-Secret on every call.
 *
 * Anyone hitting /functions/v1/poll-meshy without the right secret
 * gets a 401, no matter how many JWTs they wave around.
 *
 * ─── Why no concurrency / batching ───
 *
 * pg_cron is single-threaded per database, so we can't double-fire.
 * Inside a tick the worker processes rows sequentially — see
 * worker.ts header for the rationale.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  pollAllInFlight,
  type WorkerDeps,
  type InFlightRow,
  type MeshyTaskSnapshot,
  type MeshyTaskStatus,
} from "./worker.ts";

// ── env ─────────────────────────────────────────────────────
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are auto-injected by
// the Edge Functions runtime — they don't need to be set with
// `supabase secrets`. MESHY_API_KEY + CRON_SECRET are the two
// secrets the operator must set explicitly (see deploy steps in
// the commit message).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MESHY_KEY = Deno.env.get("MESHY_API_KEY") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

const MESHY_BASE = "https://api.meshy.ai/openapi/v1/multi-image-to-3d";
const MODELS_BUCKET = "models";

// ── Supabase admin client (service-role; bypasses RLS) ──────
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// ── Real-runtime implementations of WorkerDeps ──────────────
const deps: WorkerDeps = {
  async listInFlight(): Promise<InFlightRow[]> {
    const { data, error } = await supabase
      .from("products")
      .select("id, meshy_task_id, meshy_attempts")
      .eq("meshy_status", "generating")
      .not("meshy_task_id", "is", null);
    if (error) throw new Error(`listInFlight: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      meshyTaskId: r.meshy_task_id,
      meshyAttempts: r.meshy_attempts ?? 0,
    }));
  },

  async fetchTask(taskId: string): Promise<MeshyTaskSnapshot> {
    if (!MESHY_KEY) throw new Error("MESHY_API_KEY not set in function env");
    const res = await fetch(`${MESHY_BASE}/${encodeURIComponent(taskId)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${MESHY_KEY}` },
      // Polling — never serve from cache.
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Meshy GET ${taskId}: HTTP ${res.status} — ${body.slice(0, 300)}`);
    }
    const raw = (await res.json()) as Record<string, unknown>;
    // Inline normalize — duplicates the logic in src/lib/meshy.ts's
    // normalizeTask() because importing across the Node/Deno
    // boundary is more pain than it's worth for ~10 lines.
    const allowed: MeshyTaskStatus[] = [
      "PENDING",
      "IN_PROGRESS",
      "SUCCEEDED",
      "FAILED",
      "CANCELED",
    ];
    const status: MeshyTaskStatus = (allowed as string[]).includes(raw.status as string)
      ? (raw.status as MeshyTaskStatus)
      : "PENDING";
    const modelUrls = (raw.model_urls ?? {}) as Record<string, unknown>;
    const glbUrl =
      typeof modelUrls.glb === "string" && modelUrls.glb.length > 0
        ? (modelUrls.glb as string)
        : undefined;
    const taskError = raw.task_error as { message?: unknown } | undefined;
    const errorMessage =
      taskError && typeof taskError.message === "string" ? taskError.message : undefined;
    return { id: String(raw.id ?? taskId), status, glbUrl, errorMessage };
  },

  async downloadGlb(url: string): Promise<Uint8Array> {
    const res = await fetch(url, { method: "GET" });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`downloadGlb: HTTP ${res.status} — ${body.slice(0, 300)}`);
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  },

  async uploadGlb(productId: string, bytes: Uint8Array): Promise<string> {
    const path = `products/${productId}/model.glb`;
    const { error } = await supabase.storage
      .from(MODELS_BUCKET)
      .upload(path, new Blob([bytes], { type: "model/gltf-binary" }), {
        upsert: true,
        contentType: "model/gltf-binary",
        cacheControl: "31536000",
      });
    if (error) throw new Error(`uploadGlb: ${error.message}`);
    const { data } = supabase.storage.from(MODELS_BUCKET).getPublicUrl(path);
    // Cache-bust so the operator's <model-viewer> picks up the new
    // bytes immediately on the post-success page refresh — without
    // this, the 1-year cacheControl would keep serving the old GLB.
    return `${data.publicUrl}?v=${Date.now()}`;
  },

  async markSucceeded(productId: string, glbUrl: string) {
    const nowIso = new Date().toISOString();
    // ── 1. Try the full update — including status='published'.
    const { error: fullErr } = await supabase
      .from("products")
      .update({
        meshy_status: "succeeded",
        glb_url: glbUrl,
        glb_generated_at: nowIso,
        glb_source: "meshy",
        meshy_error: null,
        status: "published",
      })
      .eq("id", productId);
    if (!fullErr) return { promoted: true };

    // ── 2. Trigger likely fired (room_slugs missing on a row that
    //    somehow got into 'generating' without rooms — operator
    //    edited the row mid-flight, or migration backfill weirdness).
    //    Stamp the meshy success without the status flip.
    const { error: partialErr } = await supabase
      .from("products")
      .update({
        meshy_status: "succeeded",
        glb_url: glbUrl,
        glb_generated_at: nowIso,
        glb_source: "meshy",
        meshy_error: `GLB stored OK, but auto-promote to 'published' blocked: ${fullErr.message}`,
      })
      .eq("id", productId);
    if (partialErr) {
      throw new Error(
        `markSucceeded both attempts failed — full: ${fullErr.message}; partial: ${partialErr.message}`,
      );
    }
    return { promoted: false, partialErrorMsg: fullErr.message };
  },

  async markFailed(productId: string, reason: string) {
    const { error } = await supabase
      .from("products")
      .update({
        meshy_status: "failed",
        meshy_error: reason,
      })
      .eq("id", productId);
    if (error) throw new Error(`markFailed: ${error.message}`);
  },

  log(msg: string) {
    // Edge Functions stream stdout to Supabase's log viewer.
    console.log(msg);
  },
};

// ── HTTP handler ────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  // Method gate — accept POST (cron) and GET (manual debugging
  // via curl). Reject anything else.
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method not allowed", { status: 405 });
  }

  // Auth gate — shared secret, NOT JWT (function deployed with
  // --no-verify-jwt). The cron job in Commit 6 sets X-Cron-Secret
  // from current_setting('app.cron_secret').
  const presented = req.headers.get("x-cron-secret") ?? "";
  if (!CRON_SECRET || presented !== CRON_SECRET) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const startedAt = Date.now();
  let result;
  try {
    result = await pollAllInFlight(deps);
  } catch (err) {
    // Should never reach here — pollAllInFlight catches its own
    // listInFlight errors. Belt-and-braces.
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: msg, durationMs: Date.now() - startedAt }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      durationMs: Date.now() - startedAt,
      scanned: result.scanned,
      outcomes: result.outcomes,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
