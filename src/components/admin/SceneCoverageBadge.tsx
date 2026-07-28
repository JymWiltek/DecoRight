import { sceneCoverageVerdict } from "@/lib/scene-coverage";

/**
 * Scene-coverage QC badge (PB #33). Renders the single sceneCoverageVerdict for
 * a product's stored scene_coverage_pct — green in-range, rose out-of-range
 * (with the number + which bound it broke), grey when unmeasured. No hooks →
 * safe in server OR client trees. Display only; the verdict logic lives once in
 * lib/scene-coverage.
 */
export default function SceneCoverageBadge({ pct }: { pct: number | null }) {
  const v = sceneCoverageVerdict(pct);
  const cls =
    v.status === "ok"
      ? "bg-emerald-100 text-emerald-700"
      : v.status === "unmeasured"
        ? "bg-neutral-100 text-neutral-500"
        : "bg-rose-100 text-rose-700";
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
      title="场景图占比质检(合格区间 30–60%)"
    >
      {v.label}
    </span>
  );
}
