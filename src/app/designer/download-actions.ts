"use server";

import { requireDesigner } from "@/lib/auth/require-designer";
import { spendForDownload } from "@/lib/credit";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildFbxDownload } from "@/lib/format";

export type StartFbxResult =
  | { ok: true; url: string }
  | { ok: false; code: "unauthorized" | "no_file" | "insufficient" | "db"; balance?: number };

/**
 * Sprint 1 C2 — gated FBX download. A logged-in designer clicks Download
 * FBX → this deducts products.download_credit_cost via spendForDownload
 * (atomic, refuses to go negative), records a `downloads` row, and
 * returns the URL the browser should fetch. GLB / AR stay free and open.
 *
 * NOTE: the `models` bucket is public and the FBX path is conventional,
 * so this is a credit-flow gate (the normal UI path always deducts), not
 * a cryptographic paywall — true enforcement needs a private bucket
 * (flagged as follow-up). Credit deduction + history are real and
 * testable end-to-end.
 */
export async function startFbxDownload(productId: string): Promise<StartFbxResult> {
  let designerId: string;
  try {
    ({ designerId } = await requireDesigner());
  } catch {
    return { ok: false, code: "unauthorized" };
  }

  const supabase = createServiceRoleClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, name, fbx_url, fbx_bundle_url, download_credit_cost, status")
    .eq("id", productId)
    .maybeSingle();
  if (!product || product.status !== "published") {
    return { ok: false, code: "no_file" };
  }
  const dl = buildFbxDownload(product);
  if (!dl) return { ok: false, code: "no_file" };

  const cost = product.download_credit_cost ?? 0;
  const move = await spendForDownload({
    designerId,
    cost,
    productId,
    fileType: "fbx",
  });
  if (!move.ok) {
    if (move.code === "insufficient_credit") {
      return { ok: false, code: "insufficient", balance: move.balance };
    }
    return { ok: false, code: "db" };
  }

  // Record the download (credit already spent; best-effort like admin).
  await supabase.from("downloads").insert({
    designer_id: designerId,
    product_id: productId,
    bundle_id: null,
    credit_cost: cost,
    file_type: "fbx",
  });

  return { ok: true, url: dl.href };
}
