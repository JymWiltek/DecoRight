import "server-only";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { listBrands } from "@/lib/admin/brands";
import BrandsManager from "@/components/admin/BrandsManager";
// The other three tabs REUSE the existing pages verbatim — rendered here as
// components, their old /admin/* routes redirect in here via next.config. No
// logic in them changes.
import DesignersPage from "../designers/page";
import BundlesPage from "../bundles/page";
import SuppliersPage from "../suppliers/page";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "brand", label: "Brand" },
  { key: "designers", label: "Designers" },
  { key: "bundles", label: "Bundles" },
  { key: "suppliers", label: "Suppliers" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};
  const tab: TabKey = TABS.some((t) => t.key === sp.tab)
    ? (sp.tab as TabKey)
    : "brand";

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <h1 className="mb-4 text-2xl font-semibold">Settings</h1>

      <div className="mb-6 flex gap-1 border-b border-neutral-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/settings?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm transition ${
              tab === t.key
                ? "border-black font-medium text-black"
                : "border-transparent text-neutral-500 hover:text-black"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "brand" && <BrandsManager brands={await listBrands()} />}
      {tab === "designers" && <DesignersPage />}
      {tab === "bundles" && <BundlesPage />}
      {tab === "suppliers" && <SuppliersPage />}
    </div>
  );
}
