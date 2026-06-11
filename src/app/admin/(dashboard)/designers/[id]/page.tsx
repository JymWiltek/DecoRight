import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service";
import {
  SUBSCRIPTION_PLAN_CATALOG,
  type SubscriptionPlan,
} from "@/lib/supabase/types";
import {
  adminAdjustCreditAction,
  createSubscriptionAction,
  grantSubscriptionCreditAction,
} from "../actions";

/**
 * Wave 10 — designer detail page. The single screen Jym uses to:
 *   • see current credit balance + last 50 ledger rows
 *   • adjust credit manually
 *   • create a subscription
 *   • fire a monthly subscription grant (admin-paced cron stand-in)
 *   • see the recent download log
 *
 * Notification banners read query-params written by every server
 * action below — same pattern the products edit page uses.
 */

type Props = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    created?: string;
    adjusted?: string;
    subscribed?: string;
    granted?: string;
    err?: string;
    msg?: string;
  }>;
};

export default async function DesignerDetailPage({
  params,
  searchParams,
}: Props) {
  await requireAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};

  const supabase = createServiceRoleClient();
  const { data: designer } = await supabase
    .from("designers")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!designer) notFound();

  const { data: balRow } = await supabase
    .from("credit_balances")
    .select("credit_balance, updated_at")
    .eq("designer_id", id)
    .maybeSingle();

  const { data: txns } = await supabase
    .from("credit_transactions")
    .select("*")
    .eq("designer_id", id)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: subs } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("designer_id", id)
    .order("started_at", { ascending: false });

  const { data: downloads } = await supabase
    .from("downloads")
    .select(
      "id, product_id, bundle_id, credit_cost, file_type, downloaded_at",
    )
    .eq("designer_id", id)
    .order("downloaded_at", { ascending: false })
    .limit(20);

  const balance = balRow?.credit_balance ?? null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <Link
          href="/admin/designers"
          className="text-sm text-sky-700 hover:underline"
        >
          ← Designers
        </Link>
      </div>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{designer.name}</h1>
          <p className="text-sm text-neutral-500">{designer.email}</p>
          {designer.whatsapp && (
            <p className="text-xs text-neutral-400">{designer.whatsapp}</p>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs uppercase text-neutral-500">
            Credit balance
          </div>
          <div className="text-3xl font-bold tabular-nums">
            {balance ?? "—"}
          </div>
        </div>
      </div>

      {/* Toast bar */}
      {sp.created && (
        <Banner tone="green">Designer created.</Banner>
      )}
      {sp.adjusted && <Banner tone="green">Credit adjusted.</Banner>}
      {sp.subscribed && <Banner tone="green">Subscription created.</Banner>}
      {sp.granted && (
        <Banner tone="green">Monthly grant added to balance.</Banner>
      )}
      {sp.err && (
        <Banner tone="red">
          <strong>{sp.err}</strong>: {sp.msg ?? ""}
        </Banner>
      )}

      {/* Adjust credit */}
      <Section title="Adjust credit">
        <form
          action={adminAdjustCreditAction}
          className="flex flex-wrap items-end gap-3"
        >
          <input type="hidden" name="designer_id" value={id} />
          <div>
            <label className="block text-[10px] uppercase text-neutral-500">
              Amount (signed)
            </label>
            <input
              name="amount"
              type="number"
              required
              placeholder="100 or -50"
              className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] uppercase text-neutral-500">
              Note (required)
            </label>
            <input
              name="admin_note"
              type="text"
              required
              placeholder="Reason"
              className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Apply
          </button>
        </form>
      </Section>

      {/* Subscriptions */}
      <Section title="Subscriptions">
        {subs && subs.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Plan</th>
                <th className="px-2 py-1">Monthly credit</th>
                <th className="px-2 py-1">Price (MYR)</th>
                <th className="px-2 py-1">Status</th>
                <th className="px-2 py-1">Started</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id} className="border-t border-neutral-100">
                  <td className="px-2 py-1">{s.plan}</td>
                  <td className="px-2 py-1 tabular-nums">{s.monthly_credit}</td>
                  <td className="px-2 py-1 tabular-nums">
                    {(s.monthly_price_myr / 100).toFixed(2)}
                  </td>
                  <td className="px-2 py-1">{s.status}</td>
                  <td className="px-2 py-1 text-xs text-neutral-500">
                    {new Date(s.started_at).toLocaleDateString()}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {s.status === "active" && (
                      <form action={grantSubscriptionCreditAction}>
                        <input
                          type="hidden"
                          name="subscription_id"
                          value={s.id}
                        />
                        <button
                          type="submit"
                          className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:border-black"
                        >
                          Fire monthly grant
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-500">No subscriptions yet.</p>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-sky-700">
            + New subscription
          </summary>
          <form
            action={createSubscriptionAction}
            className="mt-2 flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="designer_id" value={id} />
            <div>
              <label className="block text-[10px] uppercase text-neutral-500">
                Plan
              </label>
              <select
                name="plan"
                required
                defaultValue=""
                className="rounded border border-neutral-300 px-2 py-1 text-sm"
              >
                <option value="" disabled>
                  Pick…
                </option>
                {(Object.keys(SUBSCRIPTION_PLAN_CATALOG) as SubscriptionPlan[]).map(
                  (key) => {
                    const c = SUBSCRIPTION_PLAN_CATALOG[key];
                    return (
                      <option key={key} value={key}>
                        {c.label} — {c.monthly_credit} credit · RM
                        {(c.monthly_price_myr / 100).toFixed(0)}/mo
                      </option>
                    );
                  },
                )}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase text-neutral-500">
                Override credit (optional)
              </label>
              <input
                name="monthly_credit"
                type="number"
                placeholder="catalog default"
                className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase text-neutral-500">
                Override price (MYR cents, optional)
              </label>
              <input
                name="monthly_price_myr"
                type="number"
                placeholder="catalog default"
                className="w-32 rounded border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="block text-[10px] uppercase text-neutral-500">
                Note (optional)
              </label>
              <input
                name="admin_note"
                type="text"
                className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
            >
              Subscribe
            </button>
          </form>
        </details>
      </Section>

      {/* Credit transactions */}
      <Section title="Credit transactions (last 50)">
        {txns && txns.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Time</th>
                <th className="px-2 py-1">Type</th>
                <th className="px-2 py-1 text-right">Amount</th>
                <th className="px-2 py-1">Description</th>
              </tr>
            </thead>
            <tbody>
              {txns.map((t) => (
                <tr key={t.id} className="border-t border-neutral-100">
                  <td className="px-2 py-1 text-xs text-neutral-500">
                    {new Date(t.created_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-1 text-xs">{t.type}</td>
                  <td
                    className={`px-2 py-1 text-right font-mono tabular-nums ${
                      t.amount >= 0 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    {t.amount > 0 ? "+" : ""}
                    {t.amount}
                  </td>
                  <td className="px-2 py-1 text-xs text-neutral-700">
                    {t.description ?? t.admin_note ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-500">No transactions yet.</p>
        )}
      </Section>

      {/* Downloads */}
      <Section title="Recent downloads (last 20)">
        {downloads && downloads.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-2 py-1">Time</th>
                <th className="px-2 py-1">Artifact</th>
                <th className="px-2 py-1">File</th>
                <th className="px-2 py-1 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {downloads.map((d) => (
                <tr key={d.id} className="border-t border-neutral-100">
                  <td className="px-2 py-1 text-xs text-neutral-500">
                    {new Date(d.downloaded_at).toLocaleString()}
                  </td>
                  <td className="px-2 py-1 font-mono text-[11px]">
                    {d.product_id
                      ? `product ${d.product_id.slice(0, 8)}…`
                      : `bundle ${d.bundle_id?.slice(0, 8) ?? "?"}…`}
                  </td>
                  <td className="px-2 py-1 uppercase text-xs">
                    {d.file_type}
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums">
                    −{d.credit_cost}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-neutral-500">No downloads yet.</p>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6 rounded-md border border-neutral-200 bg-white p-4">
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: "green" | "red";
  children: React.ReactNode;
}) {
  const cls =
    tone === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-rose-200 bg-rose-50 text-rose-800";
  return (
    <div className={`mt-3 rounded border px-3 py-2 text-sm ${cls}`}>
      {children}
    </div>
  );
}
