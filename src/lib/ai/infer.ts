import type { ProductInsert } from "@/lib/supabase/types";

export type InferInput = {
  name?: string;
  description?: string;
  brand?: string | null;
  imageUrls?: string[];
};

export type InferResult = {
  fields: Partial<ProductInsert>;
  inferredKeys: string[];
  model: string;
  note?: string;
};

/**
 * Phase-1 stub. Real implementation lands in Phase 3 (vision + LLM).
 * Contract: given a partial product (name/description/image), return field
 * suggestions plus the key names that were AI-set so the caller can merge
 * them into `ai_filled_fields` on the product row.
 */
export async function inferProductFields(_input: InferInput): Promise<InferResult> {
  return {
    fields: {},
    inferredKeys: [],
    model: "stub",
    note: "AI field inference lands in Phase 3",
  };
}
