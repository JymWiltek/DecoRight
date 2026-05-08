/**
 * Empty-module shim for Node-only built-ins that draco3dgltf v1.5.7's
 * Emscripten glue references but never actually invokes in the browser.
 *
 * Why this exists:
 *   The Khronos-blessed `draco3dgltf` package ships a single Emscripten-
 *   compiled JS file (draco_encoder_gltf_nodejs.js + decoder) that
 *   contains a code path like `if (process.versions.node) require('fs')`.
 *   In the browser the branch is unreachable, but Turbopack's static
 *   analysis still sees the literal `require('fs')` and fails the build
 *   with "Module not found: Can't resolve 'fs'".
 *
 *   Per the Next.js 16 upgrade guide
 *   (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md),
 *   the standard fix is `turbopack.resolveAlias` with a `browser` field
 *   pointing at an empty module — this file. The Node bundle (server
 *   components, scripts/) is unaffected and uses the real fs/path.
 *
 *   Upstream is aware (see various GitHub issues against draco) but no
 *   browser-specific entry-point ships with the package. If they ever
 *   release a browser variant we can drop this and use it directly.
 */
const empty: Record<string, never> = {};
// eslint-disable-next-line import/no-default-export
export default empty;
