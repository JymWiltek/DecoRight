import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl plugin wires our i18n config (resolves locale from cookie /
// Accept-Language, loads matching messages/*.json) into every RSC render.
// Path is relative to project root.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // PR-D (list image perf) — storefront covers used to render the raw
  // ~2 MB scene PNG from Supabase Storage via a plain <img>, at display
  // sizes as small as 64×64 (the header mega-menu). One page pulled
  // ~15 MB of covers. Routing those through next/image lets the Vercel
  // image optimizer serve a display-sized AVIF/WebP (a few KB) and
  // cache it at the edge. remotePatterns whitelists the Storage host;
  // masonry product cards keep the bespoke /api/card-image route (border
  // trim + already ~20 KB WebP), which next/image can't replicate.
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "mooggzqjybwuprrsgnny.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
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
    // Excel export/import (product bulk-edit). exceljs is server-only
    // (route handler + import server actions); keep it a runtime import
    // so the bundler doesn't choke on its Node stream/zip internals.
    "exceljs",
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
  // Sprint 1 — the catalog moved from Wave 12's 7-bathroom-rollup
  // /category/[slug] to the full-catalog /c/[category] (category =
  // item_type). 301 the old URLs so shared links + search engines
  // follow. `cabinet` mapped to item_type `bathroom_vanity`;
  // `accessory` had no products → home.
  async redirects() {
    return [
      { source: "/category/bathtub", destination: "/c/bathtub", permanent: true },
      { source: "/category/toilet", destination: "/c/toilet", permanent: true },
      { source: "/category/basin", destination: "/c/basin", permanent: true },
      { source: "/category/faucet", destination: "/c/faucet", permanent: true },
      { source: "/category/shower", destination: "/c/shower", permanent: true },
      { source: "/category/cabinet", destination: "/c/bathroom_vanity", permanent: true },
      { source: "/category/accessory", destination: "/", permanent: true },
      // Designers / Bundles / Suppliers now live under Settings tabs. The old
      // index routes redirect to the matching tab so no link goes dead. Their
      // /new and /[id] sub-routes still resolve normally.
      { source: "/admin/designers", destination: "/admin/settings?tab=designers", permanent: false },
      { source: "/admin/bundles", destination: "/admin/settings?tab=bundles", permanent: false },
      { source: "/admin/suppliers", destination: "/admin/settings?tab=suppliers", permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
