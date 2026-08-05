import { isSceneCoverUrl } from "@/lib/scene-cover-url";
import type { ImageProvenance, ImageProvenanceBy } from "@/lib/supabase/types";

/**
 * Three-layer image PROVENANCE labeling (PB). Pure of "server-only" so the
 * layer-1 rule + the precedence logic are unit-testable; the white-bg judge
 * and the AI call are injected by the caller.
 *
 *   Layer 1 (auto_rule, zero AI)  — deterministic: an AI /scene- URL → ai_scene;
 *                                    a white/studio background → product_shot.
 *   Layer 2 (auto_ai, paid)       — the leftover NULLs → the vision classifier.
 *   Layer 3 (manual)              — a human's call. NEVER overwritten by an auto
 *                                    layer (canWrite guards it).
 */

/** Admin-facing label per class (+ the unclassified state). */
export const PROVENANCE_LABELS: Record<ImageProvenance | "unknown", string> = {
  ai_scene: "AI 场景图",
  product_shot: "产品图（白底）",
  real_photo: "实拍图",
  unknown: "未分类",
};

/** The values a human may pick in the click-to-change control (layer 3). */
export const MANUAL_PROVENANCE_CHOICES: ImageProvenance[] = [
  "real_photo",
  "product_shot",
  "ai_scene",
];

/** Panel cost estimate per layer-2 AI candidate image (gpt-4o-mini, detail:low
 *  — Jym's ~$0.01/image figure; a deliberate upper bound, scene + white-bg
 *  images resolve for free in layer 1). */
export const PROVENANCE_UNIT_USD_EST = 0.01;

/**
 * Layer-1 deterministic rule (zero AI). Returns the class, or null when the
 * image is a layer-2 candidate (not a scene URL, not a white background).
 * `isWhite` is injected (production passes isWhiteBackgroundImage) so this
 * stays pure/testable.
 */
export async function classifyProvenanceRule(
  url: string | null | undefined,
  isWhite: (u: string) => Promise<boolean>,
): Promise<ImageProvenance | null> {
  if (!url) return null;
  if (isSceneCoverUrl(url)) return "ai_scene"; // AI scene cover — URL is the record
  if (await isWhite(url)) return "product_shot"; // plain white/studio cutout
  return null; // undetermined → layer-2 AI candidate
}

/**
 * May an AUTOMATIC layer (auto_rule / auto_ai) write this row? Only when it was
 * not decided by a human. A human decision (provenance_by='manual') is the top
 * authority and is never clobbered. This is the single guard both auto layers
 * consult — the same shape as image_kind_source's operator-wins rule.
 */
export function canAutoWriteProvenance(
  existingBy: ImageProvenanceBy | null | undefined,
): boolean {
  return existingBy !== "manual";
}
