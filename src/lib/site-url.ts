import { BRAND } from "@config/brand";

/**
 * The canonical public origin, resolved DYNAMICALLY so a domain change
 * is one env var, not a code edit. Priority:
 *   1. NEXT_PUBLIC_SITE_URL  — set this to the real domain (the knob Jym
 *      flips when the apex domain goes live).
 *   2. VERCEL_URL            — the per-deploy Vercel host (always set on
 *      Vercel); good enough for absolute links even on preview deploys.
 *   3. localhost (dev) / BRAND.siteUrl (prod last-resort) — only when
 *      neither env is set.
 *
 * Read at RUNTIME on the server (process.env), so changing the env +
 * restarting updates every generated URL — no rebuild, no hardcoded
 * vercel.app anywhere. Call from server components / route handlers.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}`;
  }

  // Neither env set: dev → localhost so local links work; prod → the
  // brand default (last resort if someone forgot to set the env var).
  return process.env.NODE_ENV === "production"
    ? BRAND.siteUrl.replace(/\/+$/, "")
    : "http://localhost:3000";
}

/** Build an absolute URL for a site-relative path against siteUrl(). */
export function absoluteUrl(path: string): string {
  const base = siteUrl();
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}
