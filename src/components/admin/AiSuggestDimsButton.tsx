"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  suggestProductDimsMounting,
  adoptSuggestedDimsMounting,
  type SuggestResult,
} from "@/app/admin/(dashboard)/products/ai-suggest-actions";

type Suggested = Extract<SuggestResult, { ok: true }>;

/**
 * PB-B — single-product "AI 建议" for dims + mounting. Shown on /edit when
 * dimensions or mounting are empty. Flow: click → suggest (AI, no write) →
 * review (editable numbers + explicit "AI 建议值" source label) → adopt (the
 * ONLY write) or close. Never auto-runs, never auto-writes.
 */
export default function AiSuggestDimsButton({ productId }: { productId: string }) {
  const router = useRouter();
  const [phase, setPhase] = useState<"idle" | "loading" | "result" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  const [s, setS] = useState<Suggested | null>(null);
  const [L, setL] = useState("");
  const [W, setW] = useState("");
  const [H, setH] = useState("");
  const [mount, setMount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setPhase("loading");
    setErr(null);
    const res = await suggestProductDimsMounting(productId);
    if (!res.ok) {
      setErr(res.code === "quota" ? "OpenAI 额度/限流,请稍后再试。" : res.error);
      setPhase("error");
      return;
    }
    setS(res);
    setL(res.length ? String(res.length) : "");
    setW(res.width ? String(res.width) : "");
    setH(res.height ? String(res.height) : "");
    setMount(res.mounting);
    setPhase("result");
  }

  async function adopt() {
    setBusy(true);
    setErr(null);
    const num = (v: string): number | undefined => {
      const t = v.trim();
      if (t === "") return undefined;
      const n = Number(t);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    const res = await adoptSuggestedDimsMounting(productId, {
      length: num(L),
      width: num(W),
      height: num(H),
      mounting: mount ?? undefined,
    });
    setBusy(false);
    if (!res.ok) {
      setErr(res.error);
      return;
    }
    setPhase("idle");
    setS(null);
    router.refresh();
  }

  if (phase === "idle") {
    return (
      <button
        type="button"
        onClick={run}
        className="rounded-md border border-violet-300 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 transition hover:bg-violet-100"
      >
        ✨ AI 建议尺寸 / 安装方式
      </button>
    );
  }
  if (phase === "loading") {
    return <span className="text-xs text-neutral-500">AI 估算中…</span>;
  }
  if (phase === "error") {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
        <div>AI 建议失败:{err}</div>
        <div className="mt-1 flex gap-3">
          <button type="button" onClick={run} className="underline">
            重试
          </button>
          <button type="button" onClick={() => setPhase("idle")} className="underline">
            关闭
          </button>
        </div>
      </div>
    );
  }

  // result
  const numInput =
    "w-16 rounded border border-neutral-300 px-1.5 py-1 text-xs tabular-nums";
  return (
    <div className="rounded-md border border-violet-200 bg-violet-50 p-3 text-xs text-neutral-800">
      <div className="mb-1 font-medium text-violet-800">AI 建议值 —— 请核对后采纳</div>
      <div className="mb-2 rounded bg-amber-100 px-2 py-1 text-[11px] text-amber-800">
        ⚠️ 这是 AI 基于品类常规与产品图的估算,<strong>未经规格书验证</strong>。核对/修改后再采纳。
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-neutral-500">L (mm)</span>
          <input value={L} onChange={(e) => setL(e.target.value)} className={numInput} inputMode="decimal" data-testid="ai-suggest-L" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-neutral-500">W (mm)</span>
          <input value={W} onChange={(e) => setW(e.target.value)} className={numInput} inputMode="decimal" data-testid="ai-suggest-W" />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-neutral-500">H (mm)</span>
          <input value={H} onChange={(e) => setH(e.target.value)} className={numInput} inputMode="decimal" data-testid="ai-suggest-H" />
        </label>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] uppercase text-neutral-500">Mounting</span>
          <span className="py-1 text-xs" data-testid="ai-suggest-mount">
            {s?.mountingUndeterminable || !mount ? (
              <span className="text-neutral-500">AI 无法判定(不建议)</span>
            ) : (
              <span className="font-mono text-neutral-800">{mount}</span>
            )}
          </span>
        </div>
      </div>
      {s?.rationale && (
        <div className="mt-2 text-[11px] text-neutral-600">依据:{s.rationale}</div>
      )}
      {err && <div className="mt-1 text-[11px] text-rose-700">{err}</div>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={adopt}
          disabled={busy}
          className="rounded-md bg-violet-700 px-3 py-1 text-xs font-medium text-white hover:bg-violet-800 disabled:opacity-50"
        >
          {busy ? "写入中…" : "采纳并写入"}
        </button>
        <button
          type="button"
          onClick={() => setPhase("idle")}
          disabled={busy}
          className="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 hover:border-neutral-500 disabled:opacity-50"
        >
          不用,关闭
        </button>
      </div>
    </div>
  );
}
