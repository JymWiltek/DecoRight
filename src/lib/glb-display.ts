/**
 * SSR-time render gate for the storefront <model-viewer>.
 *
 * Why this exists:
 *   The React error boundary added in commit e44aa22 is the right
 *   shape for catching synchronous render-phase failures inside
 *   <model-viewer>, but it does NOT — and cannot — catch the OS-
 *   level renderer-process kill that iOS Safari fires when a heavy
 *   GLB busts the tab heap budget during decode. The kill happens
 *   below the JS layer; React never sees it. The /product/9dbd6623
 *   incident (2026-05-09 0:47 UTC) confirmed this empirically.
 *
 *   So we close the gap by gating server-side: if the persisted
 *   decoded-budget metadata says a GLB is over the iOS-fitness
 *   thresholds, we don't render <model-viewer> at all. The page
 *   falls back to the styled-thumbnail slide ProductGallery
 *   already supports for products that have no GLB, so the visitor
 *   still sees the product (just no 3D rotate). On iOS the page
 *   stays alive; on desktop the only cost is the missed 3D viewer
 *   on the same too-heavy assets that would have struggled there
 *   too.
 *
 * Server caps are intentionally STRICTER than the admin upload caps
 * (lib/admin/compress-glb constants):
 *
 *   admin upload (rejects)        server SSR gate (skips render)
 *   ──────────────────────        ──────────────────────────────
 *   vertices  > 500_000           vertices  > 400_000
 *   texture   > 2048              texture   > 2048
 *   ram       > 120 MB            ram       > 100 MB
 *
 *   The gap (admin allows up to 500K verts but SSR skips render at
 *   400K+) leaves headroom: an upload that just barely passed admin
 *   may still be uncomfortable on iOS. We choose to display nothing
 *   rather than display a 50/50 crash. The admin operator who
 *   uploaded it sees a product that "works on Web but renders 3D
 *   only on desktop" — that's a reasonable degradation given the
 *   upload was already at the cap.
 *
 * Backward compatibility:
 *   Products uploaded before mig 0031 have NULL metadata. Treat NULL
 *   as "no info, render anyway" — those products were rendering OK
 *   before this commit landed and we don't want to silently drop
 *   their GLBs. After Jym backfills (or natural churn), all
 *   metadata becomes populated.
 *
 * Pure-data function — runs identically in server components and
 * client components. No imports from /server-only or /next.
 */

/** Server-side strict caps. Intentionally tighter than admin caps. */
export const SSR_GATE_MAX_VERTICES = 400_000;
export const SSR_GATE_MAX_TEXTURE_DIM = 2048;
export const SSR_GATE_MAX_DECODED_RAM_MB = 100;

/** Subset of ProductRow this gate cares about. Keeps the function
 *  callable from anywhere without dragging in the full row type. */
export type GlbBudgetFields = {
  glb_url: string | null;
  glb_vertex_count: number | null;
  glb_max_texture_dim: number | null;
  glb_decoded_ram_mb: number | null;
};

/**
 * Returns the GLB url that should be rendered as a 3D viewer, or
 * null if rendering would be unsafe (per the strict caps above).
 *
 *   No GLB at all                          → null  (nothing to render)
 *   GLB present + metadata NULL            → glb_url (legacy product,
 *                                             render — backward compat)
 *   GLB present + metadata under all caps  → glb_url
 *   GLB present + ANY cap exceeded         → null  (skip <model-viewer>,
 *                                             ProductGallery falls back
 *                                             to styled-thumbnail slide)
 */
export function glbUrlForGallery(p: GlbBudgetFields): string | null {
  if (!p.glb_url) return null;
  // NULL metadata = legacy product. Render. Don't penalize old uploads.
  if (
    p.glb_vertex_count === null &&
    p.glb_max_texture_dim === null &&
    p.glb_decoded_ram_mb === null
  ) {
    return p.glb_url;
  }
  // ANY cap busted → skip render.
  if ((p.glb_vertex_count ?? 0) > SSR_GATE_MAX_VERTICES) return null;
  if ((p.glb_max_texture_dim ?? 0) > SSR_GATE_MAX_TEXTURE_DIM) return null;
  if ((p.glb_decoded_ram_mb ?? 0) > SSR_GATE_MAX_DECODED_RAM_MB) return null;
  return p.glb_url;
}
