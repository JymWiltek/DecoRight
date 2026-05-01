export const BRAND = {
  name: "DecoRight",
  tagline: "看到什么，就买到什么",
  email: "hello@decoright.my",
  /** Apex domain — appears in copy ("decoright.my"), not used as a
   *  metadata base today (the site lives on Vercel; see siteUrl). */
  domain: "decoright.my",
  /** Canonical site URL — the absolute origin every metadata URL is
   *  resolved against (Next.js `metadataBase`). Must include the
   *  protocol and NO trailing slash. Update this when the apex
   *  domain becomes the primary URL — at that point also rewrite
   *  outgoing share previews so social caches refresh.
   *
   *  Why a constant and not `process.env.VERCEL_URL`: VERCEL_URL is
   *  the per-deployment subdomain (deco-right-abc123.vercel.app),
   *  so OG previews would point at preview deploys and break in
   *  Slack/WhatsApp once the deploy is rotated. The canonical URL
   *  has to be stable across deploys. */
  siteUrl: "https://deco-right.vercel.app",
  locale: "zh-CN",
  primaryColor: "#000000",
  accentColor: "#0EA5E9",
} as const;

export type Brand = typeof BRAND;
