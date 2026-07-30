"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  getAiPanelInfo,
  type AiPanelInfo,
} from "@/app/admin/(dashboard)/products/ai-bulk-actions";
import {
  suggestProductDimsMounting,
  adoptSuggestedDimsMounting,
} from "@/app/admin/(dashboard)/products/ai-suggest-actions";

/**
 * PB-B — batch "AI 建议尺寸/mounting". Runs the SUGGEST action per product
 * (Abort-bound, 429 stops), then a comparison table Jym reviews. Per-row
 * checkbox defaults OFF; only CHECKED rows are written on "采纳所选" (the only
 * spend point is the suggest calls, ~$0.01 each — shown before running).
 * NEVER auto-writes.
 */

const UNIT_USD = 0.01;

type Row = {
  id: string;
  ok: boolean;
  error?: string;
  L: string;
  W: string;
  H: string;
  mounting: string | null;
  mountingUndeterminable: boolean;
  rationale: string;
  checked: boolean;
};

type Phase = "config" | "running" | "review" | "done";

export default function BulkAiSuggestFlow({
  ids,
  onClose,
}: {
  ids: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [info, setInfo] = useState<AiPanelInfo | null>(null);
  const [phase, setPhase] = useState<Phase>("config");
  const [done, setDone] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [quotaHit, setQuotaHit] = useState(false);
  const [adoptedCount, setAdoptedCount] = useState(0);
  const abortRef = useRef(false);

  useEffect(() => {
    let live = true;
    getAiPanelInfo(ids).then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [ids]);

  const meta = new Map((info?.products ?? []).map((p) => [p.id, p]));

  async function run() {
    setPhase("running");
    abortRef.current = false;
    const out: Row[] = [];
    for (let i = 0; i < ids.length; i++) {
      if (abortRef.current) break;
      const id = ids[i];
      const res = await suggestProductDimsMounting(id);
      if (!res.ok && res.code === "quota") {
        setQuotaHit(true);
        break;
      }
      out.push(
        res.ok
          ? {
              id,
              ok: true,
              L: res.length ? String(res.length) : "",
              W: res.width ? String(res.width) : "",
              H: res.height ? String(res.height) : "",
              mounting: res.mounting,
              mountingUndeterminable: res.mountingUndeterminable,
              rationale: res.rationale,
              checked: false,
            }
          : {
              id,
              ok: false,
              error: res.error,
              L: "",
              W: "",
              H: "",
              mounting: null,
              mountingUndeterminable: true,
              rationale: "",
              checked: false,
            },
      );
      setDone(i + 1);
    }
    setRows(out);
    setPhase("review");
  }

  function patch(id: string, p: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }

  async function adoptSelected() {
    setPhase("done");
    const num = (v: string): number | undefined => {
      const t = v.trim();
      if (t === "") return undefined;
      const n = Number(t);
      return Number.isFinite(n) && n > 0 ? n : undefined;
    };
    let n = 0;
    for (const r of rows.filter((r) => r.checked && r.ok)) {
      const res = await adoptSuggestedDimsMounting(r.id, {
        length: num(r.L),
        width: num(r.W),
        height: num(r.H),
        mounting: r.mounting ?? undefined,
      });
      if (res.ok) n++;
    }
    setAdoptedCount(n);
    router.refresh();
  }

  const selectedCount = rows.filter((r) => r.checked && r.ok).length;
  const numCls = "w-14 rounded border border-neutral-300 px-1 py-0.5 text-xs tabular-nums";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <h2 className="text-lg font-semibold">
            ✨ AI 建议尺寸 / 安装方式 · {ids.length} 个产品
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "running"}
            className="text-sm text-neutral-400 hover:text-neutral-700 disabled:opacity-40"
          >
            ✕
          </button>
        </div>

        {phase === "config" && (
          <>
            <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
              ⚠️ AI 只给<strong>建议</strong>,不写库。跑完你逐行核对、勾选、可改数字,点「采纳所选」才写。
            </div>
            <div className="mt-3 rounded-md bg-neutral-50 px-3 py-2 text-sm">
              预估花费:<strong>${(ids.length * UNIT_USD).toFixed(2)}</strong>{" "}
              <span className="text-xs text-neutral-500">
                （{ids.length} × ~${UNIT_USD.toFixed(2)}/个,gpt-4o-mini 视觉,实际以 OpenAI 账单为准）
              </span>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>
                取消
              </button>
              <button type="button" onClick={run} className={btnPrimary}>
                开始估算
              </button>
            </div>
          </>
        )}

        {phase === "running" && (
          <>
            <div className="mb-2 text-sm">估算中 {done}/{ids.length}…</div>
            <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              <div className="h-full bg-black transition-all" style={{ width: `${Math.round((done / ids.length) * 100)}%` }} />
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => (abortRef.current = true)} className={btnGhost}>
                Abort
              </button>
            </div>
          </>
        )}

        {phase === "review" && (
          <>
            {quotaHit && (
              <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                <strong>OpenAI 额度/限流,已停。</strong> 已估算的在下方,充值后再选剩余的重跑。
              </div>
            )}
            <div className="mb-2 text-xs text-neutral-500">
              逐行核对 · 默认全不勾 · 勾选后可改数字 · 只有勾选的会写库
            </div>
            <table className="w-full text-left text-xs" data-testid="ai-suggest-table">
              <thead className="border-b text-[10px] uppercase text-neutral-400">
                <tr>
                  <th className="p-1"></th>
                  <th className="p-1">产品</th>
                  <th className="p-1">L</th>
                  <th className="p-1">W</th>
                  <th className="p-1">H</th>
                  <th className="p-1">Mounting</th>
                  <th className="p-1">依据</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = meta.get(r.id);
                  return (
                    <tr key={r.id} className="border-b align-top">
                      <td className="p-1">
                        <input
                          type="checkbox"
                          checked={r.checked}
                          disabled={!r.ok}
                          onChange={(e) => patch(r.id, { checked: e.target.checked })}
                          data-testid={`ai-suggest-row-${r.id}`}
                        />
                      </td>
                      <td className="p-1">
                        <div className="flex items-center gap-2">
                          {m?.thumbnail ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.thumbnail} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                          ) : (
                            <span className="h-8 w-8 shrink-0 rounded bg-neutral-100" />
                          )}
                          <span>
                            <span className="block max-w-[140px] truncate font-medium">{m?.name ?? r.id.slice(0, 8)}</span>
                            {m?.sku && <span className="text-[10px] text-neutral-400">{m.sku}</span>}
                          </span>
                        </div>
                      </td>
                      {r.ok ? (
                        <>
                          <td className="p-1"><input value={r.L} onChange={(e) => patch(r.id, { L: e.target.value })} className={numCls} /></td>
                          <td className="p-1"><input value={r.W} onChange={(e) => patch(r.id, { W: e.target.value })} className={numCls} /></td>
                          <td className="p-1"><input value={r.H} onChange={(e) => patch(r.id, { H: e.target.value })} className={numCls} /></td>
                          <td className="p-1">
                            {r.mountingUndeterminable || !r.mounting ? (
                              <span className="text-neutral-400">AI 无法判定</span>
                            ) : (
                              <span className="font-mono">{r.mounting}</span>
                            )}
                          </td>
                          <td className="max-w-[180px] p-1 text-[11px] text-neutral-500">{r.rationale}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="p-1 text-rose-600">失败:{r.error}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className={btnGhost}>取消</button>
              <button
                type="button"
                onClick={adoptSelected}
                disabled={selectedCount === 0}
                className={btnPrimary}
              >
                采纳所选（{selectedCount}）
              </button>
            </div>
          </>
        )}

        {phase === "done" && (
          <>
            <div className="mb-3 text-sm">✓ 已写入 <strong>{adoptedCount}</strong> 个产品(标记 AI-建议-人工确认)。</div>
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className={btnPrimary}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const btnPrimary =
  "rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-50";
const btnGhost =
  "rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:border-neutral-500 disabled:opacity-50";
