import "server-only";

import sharp from "sharp";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Scene-cover engine (Wave 13, Mode A) — WHOLE-IMAGE generation.
 *
 * HARD RULE (Jym, permanent): the product is drawn INTO the scene by
 * gpt-image-1 (images.edit, no mask), so it genuinely sits on the
 * counter/floor with integrated perspective, shadow and lighting. The old
 * "empty scene + composite the cutout on top" method is DELETED — it made
 * floating ghost images (hovering product + fake ellipse shadow), worse than
 * a plain white background. Never reintroduce compositing here.
 *
 * Fidelity is enforced by a hard prompt constraint ("keep the product 100%
 * identical"). A cover that drifts is re-run individually — that is
 * acceptable; ghost images are not.
 *
 * Tone routing by primary colour/material stays (warm / cool / luxury /
 * neutral) — a fidelity aid too: a warm scene around a dark/colour product
 * skews how its colour reads.
 *
 * Stateless idempotency: "already scened" == thumbnail is a /scene- URL.
 */

const CW = 1024;
const CH = 1536;

type Tone = "warm" | "cool" | "luxury" | "neutral";

function classify(colors: string[], name: string): Tone {
  const arr = (colors ?? []).map((c) => String(c).toLowerCase());
  const primary = arr[0] ?? "";
  const t = (primary + " " + name).toLowerCase();
  if (/blue|green|purple|violet|teal|pink|magenta|\bred\b|amber|turquoise|aqua|lilac|coral/.test(t))
    return "neutral";
  if (/gold|rose gold|rose_gold|\brose\b|brass|champagne|bronze/.test(t)) return "luxury";
  // White ceramic / wood furniture belongs to the light "warm" family even
  // when it has black/grey accents (a white vanity should sit in a light
  // room, not a dark one). Only truly dark/metal products go "cool".
  if (arr.includes("white")) return "warm";
  if (/black|dark|grey|gray|gunmetal|gun metal|graphite|charcoal|chrome|stainless|steel|nickel|silver/.test(t))
    return "cool";
  return "warm";
}

// Diversified background pools (Wave 13, stop the warm-beige monotone). Each
// family rotates across cool/warm/light/dark variants via pickVariant (hashed
// on the product id → stable per product, spread across the catalogue):
//   warm    = white ceramic / wood → beige / light-grey / cool-white / soft-green
//   cool    = black / chrome / gunmetal / steel → cool-grey / concrete / dark / industrial
//   luxury  = gold / rose-gold / brass → dark-luxury / warm-boutique / neutral / dark-green
//   neutral = colourful products → clean neutral gallery
const PALETTES: Record<Tone, string[]> = {
  warm: [
    "a soft minimalist bathroom with warm beige plaster walls, light travertine floor and diffused warm daylight",
    "a clean minimalist bathroom with pale warm-grey stone walls, light concrete floor and soft even daylight",
    "a bright airy bathroom with crisp cool-white walls, pale grey large-format tile and clean north-facing daylight",
    "a calm spa bathroom with soft sage-green plaster walls, light oak accents and gentle diffused daylight",
  ],
  cool: [
    "a cool modern bathroom with matte pale-grey stone and concrete, crisp cool-white daylight",
    "a contemporary bathroom with raw concrete and charcoal microcement walls, soft cool north light",
    "a moody dark bathroom with deep charcoal stone walls and low-key dramatic lighting",
    "a minimalist industrial bathroom with brushed grey concrete, dark-grout tile and neutral cool light",
  ],
  luxury: [
    "a dark luxury bathroom with near-black marble walls and warm low-key lighting",
    "a warm boutique bathroom with deep taupe walls, walnut cabinetry and soft warm pooled light",
    "an elegant neutral bathroom with soft greige stone walls and even refined daylight",
    "a boutique-hotel bathroom in dark green-black marble with warm pooled light",
  ],
  neutral: [
    "a clean neutral gallery-like bathroom with soft light-grey walls and even shadowless daylight",
    "a minimal studio-like bathroom with off-white walls, pale grey floor and bright even light",
    "an airy neutral bathroom with white plaster walls, light grey stone and soft cool-neutral daylight",
  ],
};
// Living-room palettes for sofas etc. (index-matched to Tone by reuse of hue).
const LIVING: Record<Tone, string> = {
  warm: "a bright Scandinavian living room with warm white walls, light oak floor and a large window",
  cool: "a cool modern living room with grey concrete walls, matte flooring and soft cool daylight",
  luxury: "a dark luxury living room with charcoal walls, walnut and warm gold accent lighting",
  neutral: "a clean neutral living room with soft light-grey walls and even daylight",
};
// Kitchen scenes for range hoods etc. — rotated cool/warm/dark/light so a
// wall of extractor hoods still varies (a range hood belongs over a cooktop,
// never in a bathroom next to towels).
const KITCHEN: string[] = [
  "a modern kitchen with matte pale-grey cabinetry, a cooktop directly below and soft cool daylight",
  "a contemporary kitchen with warm wood cabinets, a stone backsplash, a cooktop directly below and gentle warm light",
  "a sleek dark kitchen with charcoal cabinetry, a cooktop directly below and moody low-key lighting",
  "a minimalist kitchen with white cabinets, a concrete counter, a cooktop directly below and clean cool daylight",
];

function pickVariant(seed: string, arr: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

function isLivingItem(itemType: string | null): boolean {
  return !!itemType && /sofa|dining_table|dining_chair|bed_frame|cabinet|console/.test(itemType);
}

function isKitchenItem(itemType: string | null): boolean {
  return !!itemType && /range_hood/.test(itemType);
}

/** Where the product physically belongs — so Mode A grounds it correctly. */
function surfaceHint(itemType: string | null, name: string): string {
  if (/range_hood/.test(itemType ?? ""))
    return "The product is mounted ON the kitchen wall directly above the cooktop or hob.";
  if (/wall.?hung|wall.?mount|壁挂/i.test(name)) return "The product is mounted ON the wall.";
  const it = itemType ?? "";
  if (/faucet|basin|sink|showerhead/.test(it))
    return "The product rests fully ON a countertop, sitting on the surface.";
  if (/shower/.test(it)) return "The product is mounted ON the wall.";
  if (/toilet|bidet|bathtub/.test(it)) return "The product stands fully ON the floor, grounded.";
  if (/sofa|bed_frame|cabinet/.test(it)) return "The product rests fully ON the floor.";
  if (/dining_table|dining_chair/.test(it)) return "The product stands fully ON the floor.";
  return "The product rests naturally ON the surface, fully grounded — not floating.";
}

function scenePrompt(itemType: string | null, name: string, tone: Tone, seed: string): string {
  const scene = isKitchenItem(itemType)
    ? pickVariant(seed, KITCHEN)
    : isLivingItem(itemType)
      ? LIVING[tone]
      : pickVariant(seed, PALETTES[tone]);
  return (
    `Place this exact product into ${scene}. ${surfaceHint(itemType, name)} ` +
    `The product must be genuinely INSTALLED in the scene — sitting/standing/mounted on the surface ` +
    `with correct perspective, natural contact shadows, and fully integrated lighting and reflections. ` +
    `It must NOT look pasted-on, floating, hovering, or tilted off the surface. ` +
    `CRITICAL: keep the product 100% identical — same shape, colour, material, proportions and details; ` +
    `do NOT redesign, recolour or restyle it. You may add tasteful ambient props (a plant, folded towels, ` +
    `soap) and clearly-separate companion items, but never attach anything to the product or add anything ` +
    `that could be mistaken as part of it. Photorealistic, the product is the hero, clean minimal composition.`
  );
}

/**
 * Mode A: put the product on a portrait white canvas, then let gpt-image-1
 * redraw the WHOLE frame with the product placed into a scene. No mask, no
 * compositing.
 */
export async function buildSceneCoverPng(
  sourceBytes: Uint8Array,
  itemType: string | null,
  colors: string[],
  name: string,
  seed: string,
): Promise<Buffer> {
  const tone = classify(colors, name);
  const prod = await sharp(Buffer.from(sourceBytes), { failOn: "none" })
    .flatten({ background: "#ffffff" })
    .trim({ threshold: 12 })
    .resize(Math.round(CW * 0.72), Math.round(CH * 0.62), {
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();
  const pm = await sharp(prod).metadata();
  const left = Math.round((CW - (pm.width ?? 0)) / 2);
  const top = Math.round(CH * 0.5 - (pm.height ?? 0) / 2);
  const base = await sharp({
    create: { width: CW, height: CH, channels: 3, background: "#ffffff" },
  })
    .composite([{ input: prod, left, top }])
    .png()
    .toBuffer();

  return gptEditWholeImage(base, scenePrompt(itemType, name, tone, seed));
}

/** gpt-image-1 images.edit with NO mask — whole-frame regeneration. */
async function gptEditWholeImage(baseBuf: Buffer, prompt: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const form = new FormData();
  form.set("model", "gpt-image-1");
  form.set("image", new Blob([baseBuf as BlobPart], { type: "image/png" }), "b.png");
  form.set("prompt", prompt);
  form.set("size", "1024x1536");
  form.set("quality", "medium");
  form.set("n", "1");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 180_000);
  try {
    const r = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: ctrl.signal,
    });
    const j = (await r.json()) as { data?: { b64_json?: string }[]; error?: unknown };
    if (!r.ok) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image returned");
    return Buffer.from(b64, "base64");
  } finally {
    clearTimeout(t);
  }
}

/** True iff the 4 corners are light + low-saturation + consistent — a
 *  white/studio product shot, not an already-styled render. */
export async function isWhiteBg(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf)
    .flatten({ background: "#ffffff" })
    .resize(80, 80, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = 80;
  const ch = info.channels;
  const px = (x: number, y: number) => {
    const i = (y * W + x) * ch;
    return [data[i], data[i + 1], data[i + 2]] as const;
  };
  const corners = [px(2, 2), px(77, 2), px(2, 77), px(77, 77), px(40, 2), px(2, 40)];
  const light = corners.every(([r, g, b]) => Math.min(r, g, b) >= 200);
  const lowSat = corners.every(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 22);
  const lum = corners.map(([r, g, b]) => (r + g + b) / 3);
  const consistent = Math.max(...lum) - Math.min(...lum) <= 26;
  return light && lowSat && consistent;
}

export type SceneCoverResult =
  | { status: "done"; url: string }
  | { status: "skipped"; reason: string };

/**
 * Generate + set a Mode-A scene cover for one product IF it is a white-bg
 * product shot with no scene cover yet. Idempotent + safe to re-fire; throws
 * on failure (caller logs; the white-bg thumbnail is left untouched).
 */
export async function maybeGenerateSceneCover(
  productId: string,
  opts?: { force?: boolean },
): Promise<SceneCoverResult> {
  // PB3-C A — force=true (the panel's "Regenerate existing scene images")
  // bypasses the "already has a scene cover" short-circuits so the operator
  // can deliberately overwrite. Same generation path either way.
  const force = opts?.force === true;
  const supabase = createServiceRoleClient();
  // Record the outcome so scene-gen failures are VISIBLE (no more silent
  // swallow). Ignores its own write error → no-ops safely if the
  // scene_cover_status column hasn't been migrated in yet (mig 0050).
  const setStatus = async (
    status: "pending" | "done" | "skipped" | "failed",
    error?: string,
  ): Promise<void> => {
    await supabase
      .from("products")
      .update({ scene_cover_status: status, scene_cover_error: error ?? null })
      .eq("id", productId);
  };
  const skip = async (reason: string): Promise<SceneCoverResult> => {
    await setStatus("skipped", reason);
    return { status: "skipped", reason };
  };

  const { data: product, error: pErr } = await supabase
    .from("products")
    .select("id,name,item_type,colors,thumbnail_url")
    .eq("id", productId)
    .maybeSingle();
  if (pErr) throw new Error(`db read: ${pErr.message}`);
  if (!product) return { status: "skipped", reason: "product not found" };
  if (!product.thumbnail_url) return skip("no thumbnail");
  if (!force && product.thumbnail_url.includes("/scene-"))
    return skip("already a scene cover");

  const { data: imgs } = await supabase
    .from("product_images")
    .select("id,cutout_image_url,image_kind,is_primary")
    .eq("product_id", productId);
  const rows = imgs ?? [];
  if (
    !force &&
    rows.some(
      (r) =>
        r.image_kind === "real_photo" &&
        (r.cutout_image_url ?? "").includes("/scene-"),
    )
  )
    return skip("scene row exists");

  const srcUrl =
    rows.find((r) => r.is_primary && r.cutout_image_url)?.cutout_image_url ??
    rows.find((r) => r.image_kind === "cutout" && r.cutout_image_url)?.cutout_image_url ??
    product.thumbnail_url;

  const srcBytes = Buffer.from(await (await fetch(srcUrl)).arrayBuffer());
  if (!(await isWhiteBg(srcBytes))) return skip("not a white-bg product shot");

  await setStatus("pending");
  try {
    const cover = await buildSceneCoverPng(
      srcBytes,
      product.item_type,
      product.colors ?? [],
      product.name,
      productId,
    );

    const path = `${productId}/scene-${Date.now()}.png`;
    const { error: upErr } = await supabase.storage
      .from("cutouts")
      .upload(path, new Blob([cover as BlobPart], { type: "image/png" }), {
        upsert: true,
        contentType: "image/png",
        cacheControl: "31536000",
      });
    if (upErr) throw new Error(`upload: ${upErr.message}`);
    const url = `${supabase.storage.from("cutouts").getPublicUrl(path).data.publicUrl}?v=${Date.now()}`;

    const { error: tErr } = await supabase
      .from("products")
      .update({ thumbnail_url: url })
      .eq("id", productId);
    if (tErr) throw new Error(`thumbnail update: ${tErr.message}`);

    await supabase.from("product_images").insert({
      product_id: productId,
      state: "cutout_approved",
      cutout_image_url: url,
      image_kind: "real_photo",
      skip_cutout: true,
      feed_to_ai: false,
      show_on_storefront: true,
      is_primary_thumbnail: false,
    });

    await setStatus("done");
    return { status: "done", url };
  } catch (e) {
    // Make the failure visible + keep it from being swallowed upstream.
    const msg = e instanceof Error ? e.message : String(e);
    await setStatus("failed", msg.slice(0, 1000));
    throw e;
  }
}
