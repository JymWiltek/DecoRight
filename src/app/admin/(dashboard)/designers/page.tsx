import Link from "next/link";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Wave 10 — designer list page.
 *
 * Joins designers ↔ credit_balances and counts active subscriptions
 * + last download per row. Two queries, kept narrow so the list
 * stays cheap as the table grows.
 */

type DesignerListRow = {
  id: string;
  email: string;
  name: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  credit_balance: number | null;
  active_subscription_plan: string | null;
};

export default async function DesignersPage() {
  await requireAdmin();
  const supabase = createServiceRoleClient();

  // Get every designer + their balance via a single inner read.
  // PostgREST doesn't do LEFT JOIN by default; we fetch designers,
  // then fan-out to balances + subscriptions in two more cheap reads.
  const { data: designers, error: dErr } = await supabase
    .from("designers")
    .select("id, email, name, status, created_at, last_login_at")
    .order("created_at", { ascending: false });
  if (dErr) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Designers</h1>
        <p className="mt-2 text-sm text-rose-700">{dErr.message}</p>
      </div>
    );
  }

  const designerIds = (designers ?? []).map((d) => d.id);
  const balances = designerIds.length
    ? (
        await supabase
          .from("credit_balances")
          .select("designer_id, credit_balance")
          .in("designer_id", designerIds)
      ).data ?? []
    : [];
  const subs = designerIds.length
    ? (
        await supabase
          .from("subscriptions")
          .select("designer_id, plan")
          .in("designer_id", designerIds)
          .eq("status", "active")
      ).data ?? []
    : [];

  const balanceMap = new Map(
    balances.map((b) => [b.designer_id, b.credit_balance]),
  );
  const subMap = new Map(subs.map((s) => [s.designer_id, s.plan]));

  const rows: DesignerListRow[] = (designers ?? []).map((d) => ({
    id: d.id,
    email: d.email,
    name: d.name,
    status: d.status,
    created_at: d.created_at,
    last_login_at: d.last_login_at,
    credit_balance: balanceMap.get(d.id) ?? null,
    active_subscription_plan: subMap.get(d.id) ?? null,
  }));

  return (
    <div className="p-6">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Designers</h1>
          <p className="text-sm text-neutral-500">
            {rows.length} total · Wave 10 admin-only (designer self-login
            ships later)
          </p>
        </div>
        <Link
          href="/admin/designers/new"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          + New designer
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-neutral-300 bg-neutral-50 p-8 text-center text-sm text-neutral-500">
          No designers yet. Click <strong>+ New designer</strong> to
          onboard the first one.
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Credit</th>
              <th className="px-3 py-2">Subscription</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Last login</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-neutral-100 hover:bg-neutral-50"
              >
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/designers/${r.id}`}
                    className="text-sky-700 hover:underline"
                  >
                    {r.email}
                  </Link>
                </td>
                <td className="px-3 py-2">{r.name}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.credit_balance ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {r.active_subscription_plan ? (
                    <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 ring-1 ring-emerald-200">
                      {r.active_subscription_plan}
                    </span>
                  ) : (
                    <span className="text-xs text-neutral-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      r.status === "active"
                        ? "rounded bg-neutral-100 px-2 py-0.5 text-xs text-neutral-700"
                        : "rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-700"
                    }
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {new Date(r.created_at).toLocaleDateString()}
                </td>
                <td className="px-3 py-2 text-xs text-neutral-500">
                  {r.last_login_at
                    ? new Date(r.last_login_at).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Server-side gate via redirect — same shape ProductForm uses. Avoids
 *  rendering the page UI for unauth requests. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _gate() {
  try {
    await requireAdmin();
  } catch {
    redirect("/admin/login");
  }
}
