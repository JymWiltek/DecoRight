import "server-only";
import OpenAI from "openai";

/**
 * Lazily-instantiated OpenAI client. Server-only — the import-time
 * `server-only` guard makes webpack fail the build if any client
 * component tries to pull this in.
 *
 * The key lives in OPENAI_API_KEY (NOT NEXT_PUBLIC_*, never expose
 * to the browser). On Vercel: Production + Preview, scope = server.
 * We throw a clear error at first use rather than at module-load so
 * dev boxes without the key can still `next build` unrelated work.
 *
 * Phase 2 originally used Claude Sonnet 4.5 — see ./anthropic.ts for
 * the preserved fallback if we ever want to switch back.
 */
let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to .env.local (dev) and Vercel env (Production + Preview).",
    );
  }
  _client = new OpenAI({ apiKey });
  return _client;
}

/** Current default model for translation. gpt-4o-mini is ~20× cheaper
 *  than gpt-4o, fast, and plenty accurate for 1-3 word taxonomy labels.
 *  Pinned on purpose so model upgrades are an explicit code change,
 *  not a silent drift. */
export const OPENAI_MODEL = "gpt-4o-mini";
