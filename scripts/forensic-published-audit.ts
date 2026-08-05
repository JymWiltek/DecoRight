/**
 * INCIDENT forensics — READ ONLY (pass 2). For products CREATED today: show
 * status vs the AI-tail signature (ai_filled_fields) vs what gates the drafts
 * (missing_fields). If every PUBLISHED one has AI-filled fields + no blocking
 * missing_fields, and the DRAFT ones have missing_fields, the discriminator is
 * the publish GATE inside the AI tail — i.e. an auto-publish-on-gate-pass.
 * Makes ZERO writes.
 *
 * Run: npx tsx --env-file=.env.local scripts/forensic-published-audit.ts
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_APP_SUPABASE_URL!;
const key = process.env.APP_SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false } });

const TODAY = "2026-08-05";

type Row = {
  id: string;
  name: string | null;
  item_type: string | null;
  status: string | null;
  created_at: string | null;
  updated_at: string | null;
  ai_filled_fields: unknown;
  missing_fields: unknown;
  glb_url: string | null;
  fbx_url: string | null;
  fbx_bundle_url: string | null;
  thumbnail_url: string | null;
  scene_cover_status: string | null;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

(async () => {
  const { data, error } = await sb
    .from("products")
    .select(
      "id, name, item_type, status, created_at, updated_at, ai_filled_fields, missing_fields, glb_url, fbx_url, fbx_bundle_url, thumbnail_url, scene_cover_status",
    )
    .gte("created_at", `${TODAY}T00:00:00Z`)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("query error:", error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  const pub = rows.filter((r) => r.status === "published");
  const draft = rows.filter((r) => r.status === "draft");

  console.log(`── PUBLISHED created today: ${pub.length} ──`);
  console.log("id8 | name | ai_filled? | missing_fields | glb | fbx | thumb | scene");
  for (const r of pub) {
    console.log(
      [
        r.id.slice(0, 8),
        (r.name ?? "?").slice(0, 26),
        arr(r.ai_filled_fields).length > 0 ? `AI(${arr(r.ai_filled_fields).length})` : "no-AI",
        arr(r.missing_fields).length ? arr(r.missing_fields).join(",") : "-",
        r.glb_url ? "glb" : "-",
        r.fbx_url || r.fbx_bundle_url ? "fbx" : "-",
        r.thumbnail_url ? "thumb" : "-",
        r.scene_cover_status ?? "-",
      ].join(" | "),
    );
  }

  console.log(`\n── DRAFT created today (control — why NOT published?): ${draft.length} ──`);
  for (const r of draft) {
    console.log(
      [
        r.id.slice(0, 8),
        (r.name ?? "?").slice(0, 26),
        arr(r.ai_filled_fields).length > 0 ? `AI(${arr(r.ai_filled_fields).length})` : "no-AI",
        `missing=[${arr(r.missing_fields).join(",")}]`,
        r.glb_url ? "glb" : "NO-glb",
        r.fbx_url || r.fbx_bundle_url ? "fbx" : "NO-fbx",
        r.thumbnail_url ? "thumb" : "NO-thumb",
      ].join(" | "),
    );
  }

  // Signature summary.
  const pubWithAi = pub.filter((r) => arr(r.ai_filled_fields).length > 0).length;
  const pubWithMissing = pub.filter((r) => arr(r.missing_fields).length > 0).length;
  console.log(
    `\n── signature ── published w/ AI-filled: ${pubWithAi}/${pub.length} · published w/ blocking missing_fields: ${pubWithMissing}/${pub.length}`,
  );
  console.log("repro ids (published, created today):");
  console.log(pub.map((r) => r.id).join(","));
})();
