export const BRAND = {
  name: "DecoRight",
  tagline: "看到什么，就买到什么",
  email: "hello@decoright.my",
  /** Mig 0048 — lead-capture WhatsApp (digits only, e.g. "60123456789")
   *  for the storefront "Where to buy" no-channel state. Empty → that
   *  state shows the email only. Set this to DecoRight's enquiry line. */
  whatsapp: "",
  /** Apex domain — appears in copy ("decoright.my"), not used as a
   *  metadata base today (the site lives on Vercel; see siteUrl). */
  domain: "decoright.my",
  /** FALLBACK canonical origin only. The live origin is resolved at
   *  runtime by `siteUrl()` (src/lib/site-url.ts): NEXT_PUBLIC_SITE_URL
   *  → VERCEL_URL → (this, in prod) / localhost (dev). To switch to the
   *  real apex domain, set NEXT_PUBLIC_SITE_URL — do NOT edit code or
   *  this value. Kept as the last-resort default if both env vars are
   *  missing in a production build. Protocol + no trailing slash. */
  siteUrl: "https://deco-right.vercel.app",
  locale: "zh-CN",
  primaryColor: "#000000",
  accentColor: "#0EA5E9",
} as const;

export type Brand = typeof BRAND;
