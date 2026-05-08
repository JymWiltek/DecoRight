#!/usr/bin/env node
/**
 * Copy draco3dgltf's WebAssembly artifacts into public/draco/ so the
 * browser-side Emscripten glue can fetch them at /draco/<file>.
 *
 * Why a copy step (vs. configuring a bundler-level alias):
 *   • draco3dgltf's only entry point is its NodeJS Emscripten glue,
 *     which loads .wasm via `fs.readFileSync` on Node and via fetch
 *     against a URL on browser. Turbopack can't serve files out of
 *     node_modules at predictable URLs, so the simplest stable path
 *     is to mirror the artifacts into /public.
 *   • next.config's `turbopack.resolveAlias` already shims the Node
 *     built-ins draco3dgltf accidentally references in the browser
 *     (see next.config.ts header). The .wasm files themselves still
 *     have to be reachable from the browser — that's this script.
 *   • The two .wasm files are < 600 KB combined; mirroring them is
 *     cheap and keeps Vercel's static-asset CDN serving them with
 *     full HTTP cache headers, which is what makes the second-visit
 *     cache hit free.
 *
 * Runs:
 *   • postinstall (so a fresh `npm install` populates public/draco/)
 *   • prebuild (defence-in-depth: makes `npm run build` self-healing
 *               on environments where postinstall didn't run for some
 *               reason — e.g. Vercel sometimes skips postinstall when
 *               restoring from cache).
 *
 * Idempotent: rewrites the targets every time. Cheap, no skip-logic.
 */
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url)) + "/..";
const SRC_DIR = join(ROOT, "node_modules/draco3dgltf");
const DST_DIR = join(ROOT, "public/draco");

const files = ["draco_encoder.wasm", "draco_decoder_gltf.wasm"];

mkdirSync(DST_DIR, { recursive: true });

for (const f of files) {
  const src = join(SRC_DIR, f);
  const dst = join(DST_DIR, f);
  try {
    copyFileSync(src, dst);
    const size = statSync(dst).size;
    console.log(`copy-draco-wasm: ${f} (${(size / 1024).toFixed(1)} KB)`);
  } catch (e) {
    // Don't break a fresh install if draco3dgltf isn't installed yet
    // (e.g. on a non-bootstrapped repo). The build will fail later
    // with a clearer message.
    console.warn(`copy-draco-wasm: skipped ${f}: ${(e instanceof Error ? e.message : String(e))}`);
  }
}
