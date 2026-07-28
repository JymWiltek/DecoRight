import { SCENE_COVERAGE_RANGE } from "@config/scene-style-rules";

/**
 * Scene-coverage QC verdict (PB #33) — the SINGLE decision function shared by
 * the publish gate (server) and the admin badge (client). Pure + dependency-
 * free so both can import it. Takes the stored `attributes.scene_coverage_pct`
 * (0–100, or null/undefined when the check hasn't run) and returns:
 *   - status "ok"    : in [min,max] → counts as a publishable scene
 *   - status "under" : below min    → NOT publishable, show the number
 *   - status "over"  : above max    → NOT publishable, show the number
 *   - status "unmeasured": null      → check未跑 or failed → does NOT block
 *
 * `publishable` is the ONE boolean the gate reads: true for ok AND unmeasured
 * (QC is quality control, not a hard block on a detection failure — Jym), false
 * only for a MEASURED out-of-range image. `label` is the operator-facing string.
 */
export type SceneCoverageStatus = "ok" | "under" | "over" | "unmeasured";

export type SceneCoverageVerdict = {
  status: SceneCoverageStatus;
  pct: number | null;
  publishable: boolean;
  label: string;
};

export function sceneCoverageVerdict(
  pct: number | null | undefined,
): SceneCoverageVerdict {
  const { min, max } = SCENE_COVERAGE_RANGE;
  if (typeof pct !== "number" || !Number.isFinite(pct)) {
    return { status: "unmeasured", pct: null, publishable: true, label: "占比未检测" };
  }
  const n = Math.round(pct);
  if (n < min) {
    return { status: "under", pct: n, publishable: false, label: `占比 ${n}%,低于下限 ${min}%` };
  }
  if (n > max) {
    return { status: "over", pct: n, publishable: false, label: `占比 ${n}%,超上限 ${max}%` };
  }
  return { status: "ok", pct: n, publishable: true, label: `占比 ${n}%` };
}

/** Read scene_coverage_pct off a product's attributes JSON (tolerant). */
export function readSceneCoveragePct(
  attributes: Record<string, unknown> | null | undefined,
): number | null {
  const v = attributes?.scene_coverage_pct;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
