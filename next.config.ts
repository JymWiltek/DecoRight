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
  turbopack: {
    // draco3dgltf's Emscripten-compiled glue contains a literal
    // `require('fs')` (and friends) inside a Node-only branch that
    // never runs in the browser. Turbopack's static analysis still
    // tries to resolve the requires at build time and fails.
    //
    // Per the Next 16 upgrade guide
    // (node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md),
    // the documented fix is to alias each Node built-in to an empty
    // shim for the BROWSER target only — the server target keeps the
    // real built-in. We point all four of draco3dgltf's accidental
    // Node imports at the same shim.
    resolveAlias: {
      fs: { browser: "./src/lib/admin/empty-shim.ts" },
      path: { browser: "./src/lib/admin/empty-shim.ts" },
      crypto: { browser: "./src/lib/admin/empty-shim.ts" },
      worker_threads: { browser: "./src/lib/admin/empty-shim.ts" },
    },
  },
};

export default withNextIntl(nextConfig);
