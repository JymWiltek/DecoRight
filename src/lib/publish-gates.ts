// Publish gate logic — the checks a product must satisfy before
// status='published' is allowed. Lives outside any "use server" file
// so the sync function export doesn't trip Next.js's
// "Server Actions must be async functions" build rule. Imported by
// admin actions.ts (updateProduct, setProductStatusAction,
// bulkUpdateStatusAction) where the gates are enforced.
//
// Gates in fix-order — cheapest to fix first (rooms = a few clicks in a
// picker) to costliest (GLB = run Meshy ~$0.20). PB3-A added `fbx` +
// `retailer`; unlike the original three these were never enforced, so a
// large slice of legacy published products predates them (see the PB3-A
// scan). Enforcement is therefore TRANSITION-ONLY: the caller checks the
// gates only when a row goes draft→published, never when re-saving an
// already-published row — existing incomplete products stay published,
// editable, and are never demoted (既往不咎).
//
// checkPublishGates returns ALL failing gates (not just the first) so the
// operator sees every missing item at once instead of fixing-one-then-
// rediscovering-the-next.

export type PublishGateInput = {
  rooms: string[];
  cutoutApprovedCount: number;
  glbUrl: string | null;
  /** PB3-A — bare .fbx OR packaged .fbx-zip; either satisfies the gate. */
  fbxUrl: string | null;
  /** PB3-A — number of product_suppliers links (the internal "Others"
   *  marker counts; it's a legitimate "no real channel" choice). */
  supplierCount: number;
};

export type PublishGateReason =
  | "rooms"
  | "cutouts"
  | "glb"
  | "fbx"
  | "retailer";

/** Every gate the product currently fails, in fix-order. Empty = ready to
 *  publish. */
export function missingPublishGates(input: PublishGateInput): PublishGateReason[] {
  const missing: PublishGateReason[] = [];
  if (input.rooms.length === 0) missing.push("rooms");
  if (input.cutoutApprovedCount < 1) missing.push("cutouts");
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
