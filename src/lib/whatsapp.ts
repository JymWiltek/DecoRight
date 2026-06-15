/**
 * wa.me links need a pure-digit number with the country code and NO
 * "+", spaces, dashes, or leading zero. Operators enter Malaysian
 * numbers in any local shape ("019-888 7777", "0198887777", "+60 19…");
 * this canonicalizes them to the wa.me form ("60198887777").
 *
 * Rules: strip non-digits → strip leading zeros (local trunk prefix) →
 * if it doesn't already start with the MY country code 60, prepend it.
 * Idempotent: a number already in "60…" form passes through unchanged.
 * Pure function (no server-only) so client components can call it too.
 */
export function toWaNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, ""); // drop +, spaces, dashes, letters
  d = d.replace(/^0+/, ""); // drop the local trunk leading zero(s)
  if (d.length < 6) return null; // too short to be a real number
  if (!d.startsWith("60")) d = "60" + d; // ensure MY country code
  return d;
}

/** Build a wa.me link with a URL-encoded prefilled text, or null when
 *  the number can't be normalized (caller falls back to another CTA). */
export function waLink(
  raw: string | null | undefined,
  text: string,
): string | null {
  const n = toWaNumber(raw);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
