import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Lazily-instantiated Anthropic client. Server-only — the import-time
 * `server-only` guard makes webpack fail the build if any client
 * component tries to pull this in.
 *
 * The key lives in ANTHROPIC_API_KEY (NOT NEXT_PUBLIC_*, never expose
 * to the browser). On Vercel: Production + Preview, scope = server.
 * We throw a clear error at first use rather than at module-load so
 * dev boxes without the key can still `next build` unrelated work.
 */
let _client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  if (_client) return _client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (dev) and Vercel env (Production + Preview).",
    );
  }
  _client = new Anthropic({ apiKey });
  return _client;
}

/** Current default model for translation + inference. Pinned on purpose so
 *  model upgrades are an explicit code change, not a silent drift. */
export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
