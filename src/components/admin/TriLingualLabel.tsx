/**
 * Three-row stacked label (EN / ZH / MS) used everywhere a taxonomy
 * label renders — admin chips, product-edit pickers, regions block.
 *
 * Design rules (decided 2026-04-25 with Jym):
 *   - All three rows are `text-sm` (~14px) so the eye doesn't keep
 *     re-focusing between a primary and a tiny secondary line.
 *   - Missing translation: gray "—" with a small rose-500 dot.
 *     Per-row indicator (not a chip-level border flip) so the operator
 *     sees exactly which language is missing. The chip-level amber
 *     border kept on by callers for an at-a-glance "needs attention"
 *     scan.
 *   - Color is INHERITED from the parent button (text-white on a
 *     selected pill, text-sky-800 on a recommended room, etc) via
 *     opacity tweaks rather than hard-coded text-* classes — keeps
 *     the component reusable across all callers without a tone prop.
 */

type Props = {
  en: string;
  zh: string | null;
  ms: string | null;
};

export default function TriLingualLabel({ en, zh, ms }: Props) {
  return (
    <div className="flex flex-col text-left leading-tight">
      <span className="text-sm font-semibold">{en}</span>
      {zh ? (
        <span className="text-sm opacity-80">{zh}</span>
      ) : (
        <span
          title="Missing Chinese translation"
          className="inline-flex items-center gap-1 text-sm opacity-50"
        >
          —
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
          />
        </span>
      )}
      {ms ? (
        <span className="text-sm opacity-80">{ms}</span>
      ) : (
        <span
          title="Missing Malay translation"
          className="inline-flex items-center gap-1 text-sm opacity-50"
        >
          —
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500"
          />
        </span>
      )}
    </div>
  );
}
