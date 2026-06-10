import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin wires our i18n config (resolves locale from cookie /
// Accept-Language, loads matching messages/*.json) into every RSC render.
// Path is relative to project root.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB. The /admin/products/[id]/upload action accepts
      // raw product photos which routinely exceed that — straight from
      // a phone they're 3-6MB. Bumped to 10MB so we don't get squeezed
      // out on the Pro tier (Vercel's platform-level body limit on
      // Hobby is 4.5MB and on Pro is higher; keep this above both so
      // Next isn't the bottleneck).
      bodySizeLimit: "10mb",
    },
  },
  // Wave 9 — Vercel serverless bundles only the JS reachable via
  // `import`. Draco's WASM blob (`draco_decoder_gltf.wasm`) is loaded
  // by `draco3dgltf` at runtime via `fs.readFile` from inside
  // node_modules — Vercel's tree-shaker can't see that and ships the
  // function without the .wasm, so the worker crashes with ENOENT on
  // first run. Tell Next to keep the package as a runtime import
  // (NOT bundled), which preserves the on-disk layout and `fs.readFile`
  // finds the WASM. Same applies to `gltf-validator` (Khronos's WASM
  // validator) for the same reason.
  serverExternalPackages: [
    "draco3dgltf",
    "gltf-validator",
  ],
  // Belt-and-braces: explicitly include the WASM bytes in the function
  // bundle. `serverExternalPackages` should be enough, but Vercel's
  // trace algorithm can miss `node_modules/<pkg>/*.wasm` reads when the
  // load happens via a string concatenation rather than a static path
  // — this guarantees the files reach the function's filesystem.
  outputFileTracingIncludes: {
    // The compress-glb route is the only consumer of these WASM blobs.
    // `draco3dgltf` ships `draco_encoder.wasm` + `draco_decoder_gltf.wasm`;
    // `gltf-validator` is pure JS (a dart2js bundle) so no .wasm there.
    "/api/admin/compress-glb": [
      "./node_modules/draco3dgltf/*.wasm",
      "./node_modules/draco3dgltf/draco3dgltf.js",
    ],
  },
};

export default withNextIntl(nextConfig);
