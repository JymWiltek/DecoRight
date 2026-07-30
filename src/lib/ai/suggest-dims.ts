import "server-only";

/**
 * PB-B — AI dimension/mounting SUGGESTION (never a write). Given a product's
 * white-bg photo + name + item_type, the cheapest vision tier (gpt-4o-mini)
 * estimates real-world L/W/H (mm) and a mounting guess, plus a one-line
 * rationale. This is a SUGGESTION only: the caller shows it to Jym, who
 * approves/edits/discards — the "不猜" iron rule bans silent guessing, not a
 * human-in-the-loop suggestion.
 *
 * Pure vision call (fetch to OpenAI). THROWS on API/parse failure. Real calls
 * happen only when Jym clicks the button; dev/tests mock global.fetch.
 */

export type RawDimsSuggestion = {
  length: number | null;
  width: number | null;
  height: number | null;
  /** raw string as the model returned it — the caller validates it against the
   *  mounting enum/alias table (out-of-enum ⇒ "AI 无法判定"). */
  mounting: string | null;
  rationale: string;
};

export async function suggestDimsAndMounting(input: {
  imageUrl: string;
  name: string;
  itemType: string | null;
}): Promise<RawDimsSuggestion> {
  // Sanctioned test seam (PB-B red line: 0 REAL OpenAI in dev/test). ONLY when
  // AI_SUGGEST_MOCK=1 — unset in production, so the real call always runs there.
  // The mock returns an out-of-enum mounting for names containing BADMOUNT so
  // the "AI 无法判定" path is testable.
  if (process.env.AI_SUGGEST_MOCK === "1") {
    return {
      length: 150,
      width: 80,
      height: 100,
      mounting: /BADMOUNT/i.test(input.name) ? "spaceship" : "wall_mounted",
      rationale: "(MOCK) 标准壁挂纸巾架常规约 150×80×100mm",
    };
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured");
  const bytes = Buffer.from(await (await fetch(input.imageUrl)).arrayBuffer());
  const dataUri = `data:image/png;base64,${bytes.toString("base64")}`;

  const sys =
    "You estimate the physical size and how a bathroom/furniture product mounts, " +
    "from its photo + name + category. Use TYPICAL real-world sizes for the " +
    "category (this is an educated estimate, not a spec sheet). Reply with ONLY " +
    "compact JSON.";
  const user =
    `Product name: ${input.name}\n` +
    `Category (item_type): ${input.itemType ?? "unknown"}\n` +
    `Return JSON exactly: {"length_mm": number|null, "width_mm": number|null, ` +
    `"height_mm": number|null, "mounting": "wall_mounted"|"wall_hung"|"counter_top"|` +
    `"semi_recessed"|"floor_standing"|"deck_mounted"|"built_in"|"corner"|"unknown", ` +
    `"rationale": "one short sentence in Chinese, e.g. 标准壁挂纸巾架常规约 150×80×100mm"}. ` +
    `length = widest horizontal, width = depth, height = vertical. Use "unknown" ` +
    `for mounting if you cannot tell.`;

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
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: sys },
          {
            role: "user",
            content: [
              { type: "text", text: user },
              { type: "image_url", image_url: { url: dataUri } },
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
    const parsed = JSON.parse(j.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
    const num = (v: unknown): number | null =>
      typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 10_000
        ? Math.round(v)
        : null;
    return {
      length: num(parsed.length_mm),
      width: num(parsed.width_mm),
      height: num(parsed.height_mm),
      mounting: typeof parsed.mounting === "string" ? parsed.mounting.trim() : null,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale.slice(0, 200) : "",
    };
  } finally {
    clearTimeout(t);
  }
}
