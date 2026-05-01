/**
 * Site-default Open Graph image — used by every page that doesn't
 * supply its own `openGraph.images`. Per Next 16's metadata file
 * convention, this route is auto-discovered as `/opengraph-image`
 * and Next injects `<meta property="og:image">` for the root
 * segment plus everything beneath it.
 *
 * Twitter inheritance: the X (formerly Twitter) card spec falls back
 * to og:image when twitter:image is absent
 * (https://developer.x.com/en/docs/x-for-websites/cards). We rely on
 * that fallback rather than maintain a parallel twitter-image.tsx —
 * one file, one source of truth, and Slack / Discord / WhatsApp /
 * iMessage all read og:image anyway.
 *
 * Why generated, not a static PNG in /public:
 *   • The brand wordmark + tagline track the BRAND const. A static
 *     PNG would drift the moment we tweak the tagline; ImageResponse
 *     reads it at build/request time and stays current automatically.
 *   • Statically optimized by Next on first request — subsequent
 *     hits (and crawler hits) serve from the chunk cache. No cost
 *     amortization concerns.
 *   • No designer dependency for v1 — when Jym ships brand artwork
 *     this file gets replaced with a static .png in the same path
 *     and the metadata stays untouched.
 *
 * The 1200×630 dimension is the widest-supported size across
 * Facebook (recommends 1200×630), X (summary_large_image: 1200×675
 * or 800×418, both okay), LinkedIn (1200×627), WhatsApp/iMessage
 * (any 1.91:1). 1200×630 ≈ 1.91:1 — middle-of-the-road, looks right
 * everywhere.
 */
import { ImageResponse } from "next/og";
import { BRAND } from "@config/brand";

// File-convention exports — Next reads these to set
// `og:image:type/width/height/alt` automatically.
export const alt = `${BRAND.name} — See it, buy it`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image() {
  // No external font load — we'd need to ship a .ttf in the repo
  // and bundle it. system-ui renders cleanly for English wordmarks
  // and the size/weight do most of the visual work. If the brand
  // ever needs CJK/Jawi/MS-specific glyphs in the OG (it doesn't —
  // brand mark is a Latin wordmark), revisit.
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          // Soft warm gradient — calmer than pure white, picks up
          // the storefront's neutral-50 → neutral-100 surface.
          background: "linear-gradient(135deg, #fafafa 0%, #f3f4f6 100%)",
          color: "#0a0a0a",
          fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
          padding: 80,
        }}
      >
        {/* Wordmark */}
        <div
          style={{
            fontSize: 144,
            fontWeight: 800,
            letterSpacing: -4,
            lineHeight: 1,
          }}
        >
          {BRAND.name}
        </div>
        {/* Tagline — ~3 lines worth of message, single line layout */}
        <div
          style={{
            marginTop: 28,
            fontSize: 36,
            color: "#525252",
            letterSpacing: -0.5,
          }}
        >
          See it · live with AR · buy with confidence
        </div>
        {/* Region tag — anchors the brand to its market without
         *  shouting. Same neutral as the tagline, smaller. */}
        <div
          style={{
            marginTop: 64,
            fontSize: 24,
            color: "#737373",
            letterSpacing: 1,
            textTransform: "uppercase",
          }}
        >
          3D / AR catalog · Malaysia
        </div>
      </div>
    ),
    { ...size },
  );
}
