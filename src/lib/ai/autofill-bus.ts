"use client";

/**
 * Tiny pub/sub for Vision-autofill → picker components.
 *
 * Why not context / zustand / redux: the admin form is a single
 * page and the only listeners are the 4 picker components + the
 * AIInferButton. A `window` CustomEvent is the lightest plumbing
 * that matches the codebase's existing "sibling components
 * communicate via polling" style (RoomsPicker/SubtypePicker poll
 * formEl.elements for the item_type input). Here we just invert
 * the direction — AIInferButton pushes an event, pickers listen
 * — so the pickers can apply the inferred selection without a
 * round-trip through ProductForm state.
 *
 * Two event channels:
 *   ai-autofill-apply   → AIInferButton → pickers. Fill state.
 *   ai-autofill-touched → pickers → AIInferButton. User changed a
 *                         previously-AI-filled field, drop the ✨.
 */

export type AutofillApplyDetail = {
  /** Free-text fields. AutofillTextInput / AutofillTextarea listen
   *  for these and overwrite their value when present (undefined
   *  = "AI didn't try this field, leave alone"). */
  name?: string | null;
  description?: string | null;
  /** Single-select taxonomy. */
  item_type?: string | null;
  subtype_slug?: string | null;
  /** Multi-select taxonomy. */
  room_slugs?: string[];
  styles?: string[];
  colors?: string[];
  materials?: string[];
  /** Per-field score in [0,1]. Pickers read their own key to tint
   *  the ✨ chip green/yellow/red. */
  confidence?: Partial<Record<AutofillFieldName, number>>;
};

export type AutofillFieldName =
  | "name"
  | "description"
  | "item_type"
  | "subtype_slug"
  | "room_slugs"
  | "styles"
  | "colors"
  | "materials";

const APPLY_EVENT = "ai-autofill-apply";
const TOUCHED_EVENT = "ai-autofill-touched";

export function emitAutofillApply(detail: AutofillApplyDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(APPLY_EVENT, { detail }));
}

export function subscribeAutofillApply(
  handler: (detail: AutofillApplyDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) => handler((e as CustomEvent<AutofillApplyDetail>).detail);
  window.addEventListener(APPLY_EVENT, fn);
  return () => window.removeEventListener(APPLY_EVENT, fn);
}

export function emitAutofillTouched(field: AutofillFieldName): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TOUCHED_EVENT, { detail: { field } }));
}

export function subscribeAutofillTouched(
  handler: (field: AutofillFieldName) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const fn = (e: Event) =>
    handler((e as CustomEvent<{ field: AutofillFieldName }>).detail.field);
  window.addEventListener(TOUCHED_EVENT, fn);
  return () => window.removeEventListener(TOUCHED_EVENT, fn);
}
