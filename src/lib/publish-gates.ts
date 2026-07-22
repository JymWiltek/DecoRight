// Publish gate logic — the checks a product must satisfy before
// status='published' is allowed. Lives outside any "use server" file
// so the sync function export doesn't trip Next.js's
// "Server Actions must be async functions" build rule. Imported by
// admin actions.ts (updateProduct, setProductStatusAction,
// bulkUpdateStatusAction) where the gates are enforced.
//
// Gates in fix-order — cheapest to fix first (rooms = a few clicks in a
// picker) to costliest (GLB = run Meshy ~$0.20). PB3-A added `fbx` +
// `retailer`; the scene gate (`scene`, this change) plugs the hole that let
// white-cutout-only products reach the storefront looking half-finished.
// Unlike the original three, these later gates were never enforced, so a
// large slice of legacy published products predates them (see the PB3-A
// scan + the docs/audit-2026-07-22 quality report). Enforcement is therefore
// TRANSITION-ONLY: the caller checks the gates only when a row goes
// draft→published, never when re-saving an already-published row — existing
// incomplete products stay published, editable, and are never demoted
// (既往不咎).
//
// checkPublishGates returns ALL failing gates (not just the first) so the
// operator sees every missing item at once instead of fixing-one-then-
// rediscovering-the-next.

/**
 * Gate 2's photo criteria — the exact product_images predicate whose row
 * count becomes `cutoutApprovedCount`.
 *
 * Exported because two callers have to express this as a QUERY rather than
 * as a JS check: the per-product gate loader (loadPublishGateFacts, used by
 * updateProduct / setProductStatusAction / bulkUpdateStatusAction) and the
 * admin list's batch loader (listAllProducts, which drives the "Ready to
 * publish" filter). Sharing the pure check function alone wouldn't stop
 * those two queries from drifting apart, and a drifted count would make the
 * list promise "ready" for a row the gate then rejects. One definition here,
 * both queries import it.
 *
 * Wave 7 fix-2: image_kind must be 'cutout' — 'real_photo' / 'spec_sheet'
 * rows also land at cutout_approved (skip-rembg pattern) and must NOT
 * satisfy the "has a storefront product photo" gate.
 */
export const PUBLISHABLE_PHOTO_STATE = "cutout_approved" as const;
export const PUBLISHABLE_PHOTO_KIND = "cutout" as const;

export type PublishGateInput = {
  rooms: string[];
  cutoutApprovedCount: number;
  glbUrl: string | null;
  /** PB3-A — bare .fbx OR packaged .fbx-zip; either satisfies the gate. */
  fbxUrl: string | null;
  /** PB3-A — number of product_suppliers links (the internal "Others"
   *  marker counts; it's a legitimate "no real channel" choice). */
  supplierCount: number;
  /** The product has at least one AI scene cover (its thumbnail_url is a
   *  /scene- image — see isSceneCoverUrl, the SAME proxy #21's Regenerate,
   *  the list scene chip and CategoryProgress use). "See it, buy it" lives
   *  in the scene: a white-background cutout alone is a half-finished
   *  listing, so no scene = not publishable, hard gate, no exceptions.
   *  Required (not optional like `defect`) so the compiler forces every
   *  gate-input site to supply it — that is the anti-drift guarantee. */
  hasScene: boolean;
  /** Mig 0051 — operator flagged this product as defective after eyeballing
   *  it (wrong scene image, broken 3D model, bad data). Blocks publishing
   *  until cleared. Unlike the other five this is not "something missing"
   *  but "something known-wrong", so it is checked FIRST. */
  defect?: boolean;
  defectReason?: string | null;
};

export type PublishGateReason =
  | "defect"
  | "rooms"
  | "cutouts"
  | "scene"
  | "glb"
  | "fbx"
  | "retailer";

/** Every gate the product currently fails, in fix-order. Empty = ready to
 *  publish. */
export function missingPublishGates(input: PublishGateInput): PublishGateReason[] {
  const missing: PublishGateReason[] = [];
  // Defect first: a known-bad product must not ship no matter how complete
  // the rest of it is. Everything that consults this function inherits the
  // rule for free — the list's "Ready to publish" filter stops offering the
  // row and bulk-publish refuses it, with no logic of their own.
  if (input.defect === true) missing.push("defect");
  if (input.rooms.length === 0) missing.push("rooms");
  if (input.cutoutApprovedCount < 1) missing.push("cutouts");
  // Scene sits right after the cutout it's built from and before the costlier
  // 3D gates: "See it, buy it" means the storefront shows the product IN a
  // room, not on a white swatch. Hard gate, no exceptions (Jym).
  if (!input.hasScene) missing.push("scene");
  if (!input.glbUrl) missing.push("glb");
  if (!input.fbxUrl) missing.push("fbx");
  if (input.supplierCount < 1) missing.push("retailer");
  return missing;
}

export function checkPublishGates(input: PublishGateInput):
  | { ok: true }
  | { ok: false; reasons: PublishGateReason[] } {
  const reasons = missingPublishGates(input);
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
