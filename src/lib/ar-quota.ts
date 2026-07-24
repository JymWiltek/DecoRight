/**
 * Free-AR-preview quota — the SINGLE source for the soft count.
 *
 * A logged-out visitor gets AR_FREE_LIMIT free AR opens; the 4th asks them to
 * sign in (then it's free + unlimited). The count is a plain number in
 * localStorage — deliberately SOFT: clearing storage or opening incognito
 * resets it, and there is NO server counter and NO device fingerprint. AR is
 * the "wow" that converts; the quota is a gentle nudge to register, not DRM.
 *
 * Every AR open (repeats included — 3 is a preview budget, not a per-product
 * budget) goes through incrementArViews(); every read through readArViews().
 * Keep it that way — one reader, one writer.
 */
export const AR_FREE_LIMIT = 3;

const AR_QUOTA_KEY = "dr_ar_free_views";
/** When set to a product id, the login modal was opened from that product's AR
 *  button — after the visitor signs in we resume that AR instead of making
 *  them find the entry again. */
export const AR_RESUME_KEY = "dr_ar_resume";

/** Free AR opens this browser has already used. Client-only (localStorage);
 *  returns 0 on the server or when storage is unavailable. */
export function readArViews(): number {
  if (typeof window === "undefined") return 0;
  try {
    const n = parseInt(localStorage.getItem(AR_QUOTA_KEY) ?? "0", 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Count one AR open. Returns the new total. Best-effort — a storage failure
 *  never blocks AR (nudge, not gate). */
export function incrementArViews(): number {
  const next = readArViews() + 1;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem(AR_QUOTA_KEY, String(next));
    } catch {
      // storage blocked → don't block the view
    }
  }
  return next;
}

/** Free previews still available (never negative). */
export function arViewsRemaining(): number {
  return Math.max(0, AR_FREE_LIMIT - readArViews());
}
