import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ImageKindGuess } from "@/lib/ai/parse-spec";

/** The subset of a product_images row the tagger needs, in the exact position
 *  order the images were sent to the model. */
export type TaggableImageRow = {
  id: string;
  image_kind: string;
  image_kind_source: "operator" | "ai" | null;
};

/**
 * Apply the spec-parse classifier's verdicts. Extracted from the parse action
 * so the risky part — index mapping + the never-touch-a-human rule — is
 * testable WITHOUT spending an OpenAI call: hand it mock guesses and real rows.
 *
 * Rules (all deliberately one-directional and conservative):
 *   • spec_sheet only. A product_photo verdict writes nothing — untagged
 *     already means "show it", today's default, so writing it is noise.
 *   • Only onto images nobody explicitly classified (image_kind_source IS
 *     NULL). A human's call ('operator') is never overwritten.
 *   • A missing / out-of-range index, or an image already spec_sheet, is a
 *     no-op. Never a guess.
 *
 * `inputRows[i]` MUST be the row that produced input image i — the model
 * answers by position.
 *
 * Returns how many images were newly tagged.
 */
export async function applyAiImageKinds(
  supabase: SupabaseClient,
  inputRows: TaggableImageRow[],
  guesses: ImageKindGuess[] | undefined,
): Promise<number> {
  if (!Array.isArray(guesses)) return 0;
  let tagged = 0;
  for (const g of guesses) {
    if (g?.kind !== "spec_sheet") continue;
    const row = inputRows[g.index];
    if (!row) continue; // out of range → ignore, never guess
    if (row.image_kind_source != null) continue; // a human decided; hands off
    if (row.image_kind === "spec_sheet") continue; // already right, no write
    const { error } = await supabase
      .from("product_images")
      .update({ image_kind: "spec_sheet", image_kind_source: "ai" })
      .eq("id", row.id);
    if (!error) tagged++;
  }
  return tagged;
}
