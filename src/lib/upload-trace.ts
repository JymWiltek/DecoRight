/**
 * PB-A — Bulk-create upload-chain diagnostics (EVIDENCE ONLY, no behavior
 * change). Pure, client-safe: the trace shape + host/error/route extractors and
 * the human summaries used by BulkCreateForm's tracer and its on-page "诊断详情"
 * panel. The server actions log the same traceId so the front/back logs line up.
 *
 * Philosophy (Jym): the failure must be SEEN before it can become a defence.
 * Two prior root-cause guesses (session expiry, stale deploy) were wrong; this
 * round stops guessing and instruments the whole chain so the next failure
 * reports its own culprit — the exact step, the target host (token masked), and
 * the raw error (or "网络层失败,未收到响应" when there is no HTTP status).
 */

export const UPLOAD_TRACE_PREFIX = "[upload-trace]";
export const UPLOAD_TRACE_SERVER_PREFIX = "[upload-trace-server]";

export type UploadTraceStep = {
  traceId: string;
  /** 1-based position within this submit run. */
  seq: number;
  /** machine key: "sign:glb" | "put:glb" | "createProduct" … */
  step: string;
  /** human label for the banner, e.g. "上传 model.glb 到存储". */
  label: string;
  file?: string;
  sizeBytes?: number;
  /** target host ONLY — never the signed-URL token/signature query. */
  targetHost?: string;
  /** how the byte PUT travels: straight to Storage, or via our own origin
   *  (the latter is subject to Vercel's 4.5 MB serverless body cap). "action"
   *  marks the two server-action steps (sign / create). */
  route?: "direct-storage" | "via-app-api" | "action" | "unknown";
  startMs: number;
  durationMs?: number;
  ok?: boolean;
  httpStatus?: number;
  responseBody?: string;
  errorName?: string;
  errorMessage?: string;
  /** honest note when there is NO HTTP status (network layer / TypeError). */
  note?: string;
  /** how many automatic retries the byte PUT consumed before this outcome
   *  (network-layer jitter only). Undefined/0 = clean first-try. Surfaced
   *  as `retry=N` in the detail line — Jym-visible, non-intrusive. */
  retries?: number;
};

export function newTraceId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    // fall through
  }
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Host of a URL with the token/signature query DROPPED (never logged). */
export function traceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

/** Classify the byte-PUT route by comparing the target host to the app's own
 *  origin. Storage signed URLs point at supabase.co (direct); anything on our
 *  own host would ride the 4.5 MB-capped serverless path. */
export function classifyRoute(
  targetHost: string,
  appHost: string,
): UploadTraceStep["route"] {
  if (!targetHost || targetHost === "unknown") return "unknown";
  if (appHost && targetHost === appHost) return "via-app-api";
  return "direct-storage";
}

export function classifyError(e: unknown): { name: string; message: string } {
  if (e instanceof Error) {
    return { name: e.name || "Error", message: (e.message || "").slice(0, 400) };
  }
  return { name: "Unknown", message: String(e).slice(0, 400) };
}

export function mb(bytes: number | undefined): string {
  if (bytes == null) return "?";
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** One-line human summary of the FAILED step, for the banner. */
export function stepBannerSummary(s: UploadTraceStep): string {
  const size = s.sizeBytes != null ? `(${mb(s.sizeBytes)})` : "";
  const cause =
    s.note ??
    (s.httpStatus != null
      ? `存储返回 HTTP ${s.httpStatus}`
      : s.errorMessage
        ? `${s.errorName}: ${s.errorMessage}`
        : "未知错误");
  return `第 ${s.seq} 步:${s.label}${size} 失败 —— ${cause}`;
}

/**
 * Byte-PUT auto-retry (PB). #35's instrumentation caught the real culprit:
 * a lone 45.6 MB GLB whose PUT died at the NETWORK LAYER in 23 ms (TypeError,
 * no HTTP status, connection never established) mid-batch — while both a
 * 53 MB and a 61 MB GLB in the SAME run succeeded. That is transient network
 * jitter, not a structural bug (the structural ones were fixed in earlier
 * rounds), so the fix is retry, not more forensics.
 *
 * Retry policy: at most 2 retries (3 attempts total), waiting these ms
 * before each retry. Retries happen within seconds, far inside Supabase's
 * signed-upload-URL validity (~2 h), so the same URL is safely reused — no
 * re-sign needed.
 */
export const PUT_RETRY_DELAYS_MS = [1000, 3000] as const;

/**
 * The outcome of ONE byte-PUT attempt, classified for the retry decision:
 *   - "ok"            → done.
 *   - "http-error"    → the server RESPONDED with 4xx/5xx (413, expired
 *                       signature, permission). STRUCTURAL — never retried;
 *                       retrying would only mask it.
 *   - "network-error" → fetch() itself rejected: TypeError / "Failed to
 *                       fetch", no HTTP response. Transient — this is the
 *                       only case we retry.
 */
export type PutAttemptResult =
  | { kind: "ok"; status: number }
  | { kind: "http-error"; status: number; body: string }
  | { kind: "network-error"; error: unknown };

/**
 * Run a byte-PUT with automatic retry on NETWORK-LAYER failures only.
 * `attempt()` performs one PUT and returns a classified PutAttemptResult
 * (it must catch its own fetch rejection and return "network-error" rather
 * than throwing). "ok" and "http-error" short-circuit immediately; only
 * "network-error" retries, up to `delaysMs.length` times, sleeping the
 * matching delay before each. Returns the final result plus how many
 * retries were consumed. `sleep` is injectable so tests run instantly.
 */
export async function putWithNetworkRetry(
  attempt: () => Promise<PutAttemptResult>,
  opts?: {
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<{ result: PutAttemptResult; retries: number }> {
  const delays = opts?.delaysMs ?? PUT_RETRY_DELAYS_MS;
  const sleep =
    opts?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let retries = 0;
  for (;;) {
    const result = await attempt();
    if (result.kind !== "network-error") return { result, retries };
    if (retries >= delays.length) return { result, retries }; // budget spent
    await sleep(delays[retries]);
    retries++;
  }
}

/** Failure note after the retry budget is exhausted — carries the
 *  "已自动重试 N 次" line the operator sees, and the via-app-api caveat. */
export function putRetryExhaustedNote(routeViaAppApi: boolean): string {
  return (
    `网络层失败:字节 PUT 未收到响应(TypeError,无 HTTP status)—— ` +
    `已自动重试 ${PUT_RETRY_DELAYS_MS.length} 次仍失败,请检查网络后重传` +
    (routeViaAppApi ? " · 该路径经自家 API,受 Vercel 4.5MB body 上限" : "")
  );
}

/** Raw, copyable one-liner per step for the "诊断详情" panel. */
export function stepDetailLine(s: UploadTraceStep): string {
  const parts = [
    `#${s.seq}`,
    s.ok === false ? "✗" : s.ok ? "✓" : "…",
    s.step,
    s.retries ? `retry=${s.retries}` : "",
    s.file ? `${s.file} ${mb(s.sizeBytes)}` : "",
    s.route ? `route=${s.route}` : "",
    s.targetHost ? `host=${s.targetHost}` : "",
    s.httpStatus != null ? `HTTP ${s.httpStatus}` : "",
    s.durationMs != null ? `${s.durationMs}ms` : "",
    s.note ? `note=${s.note}` : "",
    s.errorName ? `err=${s.errorName}: ${s.errorMessage ?? ""}` : "",
    s.responseBody ? `body=${s.responseBody}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
