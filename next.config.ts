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
};

export default withNextIntl(nextConfig);
