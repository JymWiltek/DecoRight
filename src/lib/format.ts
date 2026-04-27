const MYR = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMYR(value: number | null | undefined): string {
  if (value == null) return "—";
  return MYR.format(value);
}

/**
 * Build a download href + filename for a product's .glb so the file
 * lands on a designer's disk with a meaningful name (e.g.
 * "silver-free-standing-bathtub.glb") instead of the URL default
 * ("model.glb"), which would collide for every product they save.
 *
 * Two pieces, both required because of how cross-origin downloads
 * actually work:
 *
 *   1. `?download=<filename>` query — Supabase Storage echoes this
 *      into the response's `Content-Disposition: attachment;
 *      filename="..."` header. This is what survives the cross-
 *      origin trip from our app to Storage; the browser respects it
 *      and saves the file with that name.
 *
 *   2. `download="<filename>"` HTML attr — only takes effect for
 *      same-origin URLs (which Supabase Storage isn't from our app),
 *      but kept as a belt-and-braces fallback for browsers that try
 *      to honour it when CORS is permissive enough, and as a hint
 *      to context menus ("Save link as…").
 *
 * Filename strategy: lowercased ASCII slug from the product name,
 * non-alphanumerics collapsed to hyphens. If the name is all-CJK
 * (or otherwise leaves no ASCII after slugification) we fall back
 * to the first 8 chars of the UUID — short enough to type, unique
 * enough that two products in a designer's library don't collide.
 *
 * Why ASCII-only and not Unicode: SketchUp / Blender / 3ds Max have
 * a long, painful history with non-ASCII filenames on Windows +
 * CJK locales. Hyphens (not underscores) match the SketchUp
 * Warehouse convention so the file looks at home in a designer's
 * download folder.
 *
 * Returns null when the product has no GLB — caller can use that to
 * decide whether to render the button at all.
 */
export function buildGlbDownload(product: {
  id: string;
  name: string;
  glb_url: string | null;
}): { href: string; filename: string } | null {
  if (!product.glb_url) return null;
  const slug = product.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const filename = `${slug || product.id.slice(0, 8)}.glb`;
  const sep = product.glb_url.includes("?") ? "&" : "?";
  const href = `${product.glb_url}${sep}download=${encodeURIComponent(filename)}`;
  return { href, filename };
}
