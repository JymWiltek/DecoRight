import "server-only";

import sharp from "sharp";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getDefaultProvider } from "@/lib/rembg";

/**
 * Scene-cover engine (Wave 13) — "empty scene + composite original".
 *
 * The fidelity contract: the product is NEVER redrawn by AI. We
 *   1. get a transparent product cutout (rembg the white-bg upload),
 *   2. ask gpt-image-1 for an EMPTY room only (it never sees the product,
 *      so it cannot ghost/duplicate/alter it),
 *   3. composite the exact cutout pixels onto that background + a soft
 *      contact shadow.
 * Fidelity is structural, not reviewed after the fact.
 *
 * Used by the auto-trigger (/api/admin/scene-cover, fired from
 * attachStagedRawImages via after()) and could back a manual button.
 *
 * Stateless idempotency: "already has a scene cover" == the thumbnail is a
 * /scene- URL OR a real_photo scene row exists. No status column needed;
 * a failure just leaves the white-bg thumbnail untouched and is retried on
 * the next upload.
 */

const CW = 1024;
const CH = 1536;

type Profile = {
  surf: "wall" | "counter" | "floor";
  room: string;
  wBox: number;
  hBox: number;
  baseY?: number;
  leftFrac?: number;
};

// Placement + scene profile per item_type. baseY = fraction of CH where the
// product BOTTOM rests; wall items float (no floor shadow). Tuned against the
// Wave-13 backfill batch (round/most basins seat cleanly on the counter).
const PROFILE: Record<string, Profile> = {
  shower: { surf: "wall", room: "bathroom", wBox: 0.42, hBox: 0.82, leftFrac: 0.2 },
  showerhead: { surf: "wall", room: "bathroom", wBox: 0.4, hBox: 0.55, leftFrac: 0.24 },
  faucet: { surf: "counter", room: "bathroom", wBox: 0.3, hBox: 0.52, baseY: 0.72 },
  basin: { surf: "counter", room: "bathroom", wBox: 0.5, hBox: 0.4, baseY: 0.63 },
  sink: { surf: "counter", room: "bathroom", wBox: 0.5, hBox: 0.4, baseY: 0.63 },
  toilet: { surf: "floor", room: "bathroom", wBox: 0.52, hBox: 0.62, baseY: 0.88 },
  bathtub: { surf: "floor", room: "bathroom", wBox: 0.82, hBox: 0.55, baseY: 0.86 },
  sofa: { surf: "floor", room: "living room", wBox: 0.82, hBox: 0.55, baseY: 0.86 },
};
const DEFAULT_PROFILE: Profile = {
  surf: "floor",
  room: "bathroom",
  wBox: 0.6,
  hBox: 0.6,
  baseY: 0.86,
};

function profileFor(itemType: string | null, name: string): Profile {
  let prof = (itemType && PROFILE[itemType]) || DEFAULT_PROFILE;
  // wall-hung / wall-mounted fixtures cantilever off the wall — mount them on
  // the wall instead of floating over the floor.
  if (/wall.?hung|wall.?mount|壁挂/i.test(name)) {
    prof = { ...prof, surf: "wall", leftFrac: 0.26, wBox: 0.5, hBox: 0.5 };
  }
  return prof;
}

type Tone = "warm" | "cool" | "luxury" | "neutral";

/**
 * Tone bucket by PRIMARY colour/material (colors[0] + name). Also a fidelity
 * guard: a warm scene around a dark/metal/colour product makes its colour
 * read muddy by contrast, so those get cool / neutral backgrounds instead.
 * A minor accent (e.g. a chrome tap on a white basin) must not flip the tone,
 * hence primary-colour-only.
 */
function classify(colors: string[], name: string): Tone {
  const primary = (colors[0] ?? "").toLowerCase();
  const t = (primary + " " + name).toLowerCase();
  if (/blue|green|purple|violet|teal|pink|magenta|\bred\b|amber|turquoise|aqua|lilac|coral/.test(t))
    return "neutral";
  if (/gold|rose gold|\brose\b|brass|champagne|bronze/.test(t)) return "luxury";
  if (/black|dark|grey|gray|gunmetal|gun metal|graphite|charcoal|chrome|stainless|steel|nickel|silver/.test(t))
    return "cool";
  return "warm";
}

// 3 palette variants per tone so same-tone products don't look identical.
const PALETTES: Record<Tone, string[]> = {
  warm: [
    "bright Scandinavian, warm white walls and light oak wood, large soft window light",
    "warm Japandi, cream limewash walls and pale timber, gentle morning sunlight",
    "soft minimalist, beige plaster walls and light travertine, diffused warm daylight",
  ],
  cool: [
    "cool modern, matte grey stone and concrete walls, crisp cool-white daylight",
    "contemporary greyscale, charcoal microcement walls, soft cool north light",
    "minimalist cool, pale grey tile and brushed concrete, clean neutral cool lighting",
  ],
  luxury: [
    "dark luxury, deep charcoal marble walls with warm brass accents, moody low light",
    "opulent dark, near-black stone and walnut with soft gold uplight, dramatic warm glow",
    "boutique-hotel luxe, dark green-black marble with brushed gold trim, warm pooled light",
  ],
  neutral: [
    "clean neutral gallery-like interior, soft light-grey walls, even shadowless daylight, uncluttered",
    "minimal studio-like space, off-white walls and pale grey floor, bright even neutral light",
    "airy neutral, white plaster walls and light grey stone, soft cool-neutral daylight",
  ],
};
const SURFACE: Record<Tone, string> = {
  warm: "light stone",
  cool: "grey stone",
  luxury: "dark marble",
  neutral: "pale grey stone",
};

/** Stable per-product variant pick so a tone bucket isn't visually uniform. */
function pickVariant(seed: string, arr: string[]): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

function scenePrompt(prof: Profile, tone: Tone, seed: string): string {
  const pal = pickVariant(seed, PALETTES[tone]);
  const base = `An empty ${pal} ${prof.room} interior, photorealistic, minimal decor, realistic soft shadows, clean composition.`;
  const vanity =
    tone === "neutral"
      ? "a simple light-grey vanity and a plant"
      : prof.room === "living room"
        ? "a console and plant"
        : "a light-wood vanity with a white basin and a plant";
  if (prof.surf === "wall") {
    return `${base} A large clean tiled wall fills the left and center — completely BARE, NO shower NO taps NO fixtures NO pipes on it. On the right ${vanity}, and a soft-curtained window.`;
  }
  if (prof.surf === "counter") {
    return `${base} A clean ${SURFACE[tone]} counter-top fills the ENTIRE LOWER HALF of the frame as a broad flat surface seen slightly from above, completely BARE — absolutely NO basin, NO sink, NO tap, NO objects on it. A wall rises behind with soft daylight, a potted plant and folded towels off to one side.`;
  }
  return `${base} A wall and ${prof.room === "living room" ? "wood floor" : "tiled floor"} meet in the lower quarter, the floor is BARE and open — NO ${prof.room === "living room" ? "sofa NO furniture" : "toilet NO bathtub NO fixtures"} anywhere. A window with soft daylight, a plant to one side.`;
}

/** Ask gpt-image-1 for an empty room (text-to-image; product never shown). */
async function genEmptyScene(prompt: string): Promise<Buffer> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const r = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-image-1",
        prompt,
        size: "1024x1536",
        quality: "medium",
        n: 1,
      }),
      signal: ctrl.signal,
    });
    const j = (await r.json()) as {
      data?: { b64_json?: string }[];
      error?: unknown;
    };
    if (!r.ok) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error("no image returned");
    return Buffer.from(b64, "base64");
  } finally {
    clearTimeout(t);
  }
}

/** True iff the 4 corners are all light + low-saturation + consistent — a
 *  white/studio product shot, as opposed to an already-styled render. */
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

/**
 * Build the final cover PNG from a TRANSPARENT product cutout. The product
 * pixels are composited verbatim — only the background is AI.
 */
export async function buildSceneCoverPng(
  cutoutBytes: Uint8Array,
  itemType: string | null,
  colors: string[],
  name: string,
  seed: string,
): Promise<Buffer> {
  const prof = profileFor(itemType, name);
  const tone = classify(colors, name);
  const prod = await sharp(Buffer.from(cutoutBytes))
    .trim({ threshold: 6 })
    .resize(Math.round(CW * prof.wBox), Math.round(CH * prof.hBox), { fit: "inside" })
    .png()
    .toBuffer();
  const pm = await sharp(prod).metadata();
  const pw = pm.width ?? 1;
  const ph = pm.height ?? 1;
  const left =
    prof.surf === "wall"
      ? Math.round(CW * (prof.leftFrac ?? 0.2))
      : Math.round((CW - pw) / 2);
  const top =
    prof.surf === "wall"
      ? Math.round((CH - ph) / 2)
      : Math.round(CH * (prof.baseY ?? 0.86) - ph);
  const placed = await sharp({
    create: { width: CW, height: CH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: prod, left, top }])
    .png()
    .toBuffer();

  const scene = await genEmptyScene(scenePrompt(prof, tone, seed));
  let base = sharp(scene);
  if (prof.surf !== "wall") {
    // tight contact shadow hugging the base → grounds it, kills "floating".
    const sw = Math.round(pw * 0.86);
    const sh = Math.round(pw * 0.13);
    const ell = await sharp({
      create: { width: sw, height: sh, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="${sw}" height="${sh}"><ellipse cx="${sw / 2}" cy="${sh / 2}" rx="${sw / 2.2}" ry="${sh / 2.2}" fill="rgba(0,0,0,0.28)"/><ellipse cx="${sw / 2}" cy="${sh / 2}" rx="${sw / 3.4}" ry="${sh / 2.8}" fill="rgba(0,0,0,0.42)"/></svg>`,
          ),
        },
      ])
      .blur(11)
      .png()
      .toBuffer();
    base = base.composite([
      {
        input: ell,
        left: Math.round(left + pw / 2 - sw / 2),
        top: Math.round(top + ph - sh * 0.5),
      },
      { input: placed, top: 0, left: 0 },
    ]);
  } else {
    base = base.composite([{ input: placed, top: 0, left: 0 }]);
  }
  return base.png().toBuffer();
}

export type SceneCoverResult =
  | { status: "done"; url: string }
  | { status: "skipped"; reason: string };

/**
 * Orchestrator: generate + set a scene cover for one product IF it is a
 * white-bg product with no scene cover yet. Idempotent + safe to re-fire.
 * Throws on generation/upload/db failure (the caller logs; the thumbnail is
 * left untouched, so the product just keeps its white-bg cover and retries
 * on the next upload).
 */
export async function maybeGenerateSceneCover(
  productId: string,
): Promise<SceneCoverResult> {
  const supabase = createServiceRoleClient();
  const { data: product, error: pErr } = await supabase
    .from("products")
    .select("id,name,item_type,colors,thumbnail_url")
    .eq("id", productId)
    .maybeSingle();
  if (pErr) throw new Error(`db read: ${pErr.message}`);
  if (!product) return { status: "skipped", reason: "product not found" };
  if (!product.thumbnail_url) return { status: "skipped", reason: "no thumbnail" };
  if (product.thumbnail_url.includes("/scene-"))
    return { status: "skipped", reason: "already a scene cover" };

  // Skip if a scene / operator lifestyle photo already exists.
  const { data: imgs } = await supabase
    .from("product_images")
    .select("id,cutout_image_url,image_kind,is_primary")
    .eq("product_id", productId);
  const rows = imgs ?? [];
  if (rows.some((r) => r.image_kind === "real_photo" && (r.cutout_image_url ?? "").includes("/scene-")))
    return { status: "skipped", reason: "scene row exists" };

  // Source = the primary cutout, else the thumbnail.
  const srcUrl =
    rows.find((r) => r.is_primary && r.cutout_image_url)?.cutout_image_url ??
    rows.find((r) => r.image_kind === "cutout" && r.cutout_image_url)?.cutout_image_url ??
    product.thumbnail_url;

  const srcBytes = Buffer.from(await (await fetch(srcUrl)).arrayBuffer());
  if (!(await isWhiteBg(srcBytes)))
    return { status: "skipped", reason: "not a white-bg product shot" };

  // Get a transparent cutout: reuse existing alpha, else run rembg.
  const meta = await sharp(srcBytes).metadata();
  let cutoutBytes: Uint8Array;
  if (meta.hasAlpha && (await hasTransparentPixels(srcBytes))) {
    cutoutBytes = srcBytes;
  } else {
    const provider = getDefaultProvider();
    if (!provider) throw new Error("no rembg provider configured");
    const result = await provider.run({ sourceUrl: srcUrl, productId });
    cutoutBytes = result.bytes;
  }

  const cover = await buildSceneCoverPng(
    cutoutBytes,
    product.item_type,
    product.colors ?? [],
    product.name,
    productId,
  );

  // Upload to the public cutouts bucket under the scene path convention.
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

  // Add the scene as a storefront gallery row (image_kind='real_photo',
  // is_primary_thumbnail=false so the unify trigger never touches it).
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

  return { status: "done", url };
}

async function hasTransparentPixels(buf: Buffer): Promise<boolean> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .resize(64, 64, { fit: "inside" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let transp = 0;
  const n = info.width * info.height;
  for (let i = 0; i < n; i++) if (data[i * info.channels + 3] < 30) transp++;
  return transp / n > 0.05;
}
