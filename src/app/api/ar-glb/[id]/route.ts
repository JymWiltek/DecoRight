/**
 * /api/ar-glb/[id] — the product's GLB rescaled to its real-world size.
 *
 * <model-viewer>'s runtime `scale` attribute fixes only the inline view;
 * Android scene-viewer and iOS quick-look load the raw GLB and ignore it,
 * so on a phone a 2.77m sofa (normalized to ~1m by Tripo) shows toy-sized.
 * This route bakes `dimensions_mm` into the GLB itself (see lib/ar-glb), so
 * the file scene-viewer/quick-look download is already true-size.
 *
 * Serves the SAME budget-gated GLB the gallery picks (compressed when ready)
 * — the scaler is container surgery that leaves Draco buffers untouched, so
 * compression/size (and the iOS inline budget) are unchanged. No dims, or
 * any failure → 302 to the original URL (AR stays at intrinsic scale, no
 * worse than before). Strong cache; the card passes ?v=<glb version>.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { glbUrlForGallery } from "@/lib/glb-display";
import { scaleGlbToRealMeters } from "@/lib/ar-glb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const { data: p } = await supabase
    .from("products")
    .select(
      "glb_url, glb_compressed_url, compression_status, glb_vertex_count, glb_max_texture_dim, glb_decoded_ram_mb, dimensions_mm",
    )
    .eq("id", id)
    .maybeSingle();

  const url = p ? glbUrlForGallery(p) : null;
  if (!url) return NextResponse.json({ error: "no model" }, { status: 404 });

  const dims = p?.dimensions_mm as
    | { length?: number; width?: number; height?: number }
    | null;
  const realMaxMm = Math.max(dims?.length ?? 0, dims?.width ?? 0, dims?.height ?? 0);
  if (realMaxMm <= 0) return NextResponse.redirect(url, 302); // no dims → original

  let bytes: Buffer;
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return NextResponse.redirect(url, 302);
    bytes = Buffer.from(await resp.arrayBuffer());
  } catch {
    return NextResponse.redirect(url, 302);
  }

  let result;
  try {
    result = scaleGlbToRealMeters(bytes, realMaxMm);
  } catch {
    return NextResponse.redirect(url, 302);
  }
  if (!result.changed) return NextResponse.redirect(url, 302); // already real-size / not a GLB

  return new NextResponse(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "Content-Type": "model/gltf-binary",
      "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
    },
  });
}
