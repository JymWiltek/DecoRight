import "server-only";

/**
 * Layer-2 image PROVENANCE classifier (PB) — the ONLY paid step in the
 * three-layer labeling pipeline. Given a product image, the cheapest vision
 * tier (gpt-4o-mini, detail:"low") decides: a real PHOTOGRAPH taken with a
 * camera, vs a computer RENDER / 3D / AI-generated image. Returns 'real_photo'
 * or falls back to 'product_shot'. THROWS on API failure so the batch can
 * categorize quota/429 and stop.
 *
 * Real calls happen ONLY when Jym confirms the batch. Dev/tests set
 * AI_SUGGEST_MOCK=1 for 0 real calls (the sanctioned seam, unset in prod).
 */
export type PhotoProvenance = "real_photo" | "product_shot";

export async function classifyPhotoProvenance(input: {
  imageUrl: string;
  name: string;
}): Promise<PhotoProvenance> {
  // Sanctioned test seam (red line: 0 REAL OpenAI in dev/test). Names/URLs
  // containing REALPHOTO → real_photo, else product_shot — so both branches
  // are testable with zero real calls.
  if (process.env.AI_SUGGEST_MOCK === "1") {
    return /REALPHOTO/i.test(`${input.name} ${input.imageUrl}`)
      ? "real_photo"
      : "product_shot";
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const bytes = Buffer.from(await (await fetch(input.imageUrl)).arrayBuffer());
  const dataUri = `data:image/png;base64,${bytes.toString("base64")}`;

  const sys =
    "You classify a product image as a real PHOTOGRAPH taken with a camera, or " +
    "a computer RENDER / 3D / AI-generated image. Reply with ONLY compact JSON.";
  const user =
    `Product name: ${input.name}\n` +
    `Return JSON exactly: {"kind": "real_photo"|"render"}. ` +
    `"real_photo" = a genuine photograph of a physical object or scene (camera ` +
    `noise, real lighting and shadows, a real environment). "render" = CGI, a 3D ` +
    `render, a product mockup, or an AI-generated image. When unsure, answer "render".`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 20,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: dataUri, detail: "low" } },
            ],
          },
        ],
      }),
    });
    const j = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: unknown;
    };
    if (!r.ok) throw new Error(JSON.stringify(j.error ?? j).slice(0, 200));
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as Record<
      string,
      unknown
    >;
    return parsed.kind === "real_photo" ? "real_photo" : "product_shot";
  } finally {
    clearTimeout(t);
  }
}
