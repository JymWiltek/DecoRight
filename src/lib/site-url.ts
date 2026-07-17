/**
 * The canonical PUBLIC origin — the domain that ends up in customer-facing
 * absolute URLs: WhatsApp enquiry links, OpenGraph/canonical metadata, and the
 * Excel export's product_url. Resolved from ONE env var so a domain change is
 * config, not a code edit.
 *
 *   • NEXT_PUBLIC_SITE_URL set  → use it.
 *   • production, but UNSET     → THROW. We deliberately do NOT fall back to
 *     `VERCEL_URL`: that's the per-deploy host (e.g.
 *     `deco-right-<hash>-…vercel.app`) which is temporary AND auth-walled, so
 *     falling back to it shipped customers dead WhatsApp links and broke OG /
 *     the Excel export. Failing loudly forces the env to be set instead of
 *     silently emitting a bad URL. (The build itself evaluates this for
 *     metadata, so a missing env fails the deploy rather than going live.)
 *   • dev, unset                → localhost so local links work.
 *
 * NOTE: this is NOT the same as the SELF-CALL base used by the async dispatch
 * libs (glb-compression / fbx-bundle / scene-cover), which intentionally use
 * VERCEL_URL to hit the CURRENT running deployment. Those are internal and
 * must not use this canonical origin.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_SITE_URL is not set. Set it to the canonical public domain " +
        "(e.g. https://deco-right.vercel.app) in the Vercel project environment. " +
        "Refusing to fall back to the per-deploy VERCEL_URL — it is temporary, " +
        "auth-walled, and would ship dead links to customers (WhatsApp, OG, " +
        "Excel export).",
    );
  }
  return "http://localhost:3000"; // dev only
}

/** Build an absolute URL for a site-relative path against siteUrl(). */
export function absoluteUrl(path: string): string {
  const base = siteUrl();
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
