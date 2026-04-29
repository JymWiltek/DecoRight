// Publish gate logic — three checks a product must satisfy before
// status='published' is allowed. Lives outside any "use server" file
// so the sync function export doesn't trip Next.js's
// "Server Actions must be async functions" build rule. Imported by
// admin actions.ts (updateProduct, setProductStatusAction,
// bulkUpdateStatusAction) where the gates are enforced.
//
// Gates in fail-order — the FIRST failing one is surfaced to the
// operator. Earlier gates are cheaper to fix (rooms = a few clicks
// in a picker), later ones spend money (GLB = run Meshy ~$0.20).
// Reporting them in cost order lets the operator fix the cheap
// blockers first instead of paying for Meshy then discovering they
// also forgot to pick rooms.

export type PublishGateInput = {
  rooms: string[];
  glbUrl: string | null;
  cutoutApprovedCount: number;
};

export type PublishGateReason = "rooms" | "cutouts" | "glb";

export function checkPublishGates(input: PublishGateInput):
  | { ok: true }
  | { ok: false; reason: PublishGateReason } {
  if (input.rooms.length === 0) return { ok: false, reason: "rooms" };
  if (input.cutoutApprovedCount < 1) return { ok: false, reason: "cutouts" };
  if (!input.glbUrl) return { ok: false, reason: "glb" };
  return { ok: true };
}
