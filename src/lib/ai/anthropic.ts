/**
 * ⚠ INACTIVE — kept as fallback for when Anthropic credit is topped up.
 *
 * Phase 2 originally shipped with Claude Sonnet 4.5 via @anthropic-ai/sdk.
 * We swapped to OpenAI GPT-4o-mini (see ./openai.ts) when the Anthropic
 * account ran low on credit. This file is preserved so restoring Claude
 * is a one-commit operation:
 *
 *   1. npm install @anthropic-ai/sdk
 *   2. Uncomment the block below
 *   3. Change src/app/admin/(dashboard)/taxonomy/actions.ts to import
 *      `getAnthropic, CLAUDE_MODEL` from "@/lib/ai/anthropic" and use
 *      the Messages API path instead of chat.completions
 *   4. Change env var ANTHROPIC_API_KEY back in Vercel + .env.local
 *
 * DO NOT import from this file — build will break (the @anthropic-ai/sdk
 * dependency is uninstalled). The `server-only` import is intentionally
 * left active so any accidental import fails loudly at build-time.
 */

import "server-only";

// import Anthropic from "@anthropic-ai/sdk";
//
// let _client: Anthropic | null = null;
//
// export function getAnthropic(): Anthropic {
//   if (_client) return _client;
//   const apiKey = process.env.ANTHROPIC_API_KEY;
//   if (!apiKey) {
//     throw new Error(
//       "ANTHROPIC_API_KEY is not set. Add it to .env.local (dev) and Vercel env (Production + Preview).",
//     );
//   }
//   _client = new Anthropic({ apiKey });
//   return _client;
// }
//
// /** Current default model for translation + inference. Pinned on purpose so
//  *  model upgrades are an explicit code change, not a silent drift. */
// export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
