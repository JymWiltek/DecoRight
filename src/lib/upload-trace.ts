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

/** Raw, copyable one-liner per step for the "诊断详情" panel. */
export function stepDetailLine(s: UploadTraceStep): string {
  const parts = [
    `#${s.seq}`,
    s.ok === false ? "✗" : s.ok ? "✓" : "…",
    s.step,
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
