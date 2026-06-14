import "server-only";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import BulkCreateForm from "@/components/admin/BulkCreateForm";
import { loadTaxonomy, labelFor } from "@/lib/taxonomy";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/config";

export const dynamic = "force-dynamic";

/**
 * Wave 6 · Commit 4 — bulk-create page. Sprint 1 (PART B): each card now
 * carries the FULL upload set (photos+type · glb · fbx/zip · textures ·
 * dimensions · category · room) and saves via the SHARED
 * createProductFromUpload action — same server path as single-edit, so
 * the two pages can't drift. Up to 10 products at once.
 */
export default async function BulkCreatePage() {
  await requireAdmin();
  const [taxonomy, locale] = await Promise.all([
    loadTaxonomy(),
    getLocale() as Promise<Locale>,
  ]);
  const itemTypeOptions = taxonomy.itemTypes.map((t) => ({
    slug: t.slug,
    label: labelFor(t, locale),
  }));
  const roomOptions = [...taxonomy.rooms]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((r) => ({ slug: r.slug, label: labelFor(r, locale) }));
  const subtypesByItemType: Record<string, { slug: string; label: string }[]> = {};
  for (const st of taxonomy.itemSubtypes) {
    (subtypesByItemType[st.item_type_slug] ??= []).push({
      slug: st.slug,
      label: labelFor(st, locale),
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 pb-32">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bulk create products</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Up to 10 products at once — each card has the full upload set
            (photos · 3D · FBX/zip · textures · size · category · room),
            the same as single-product edit. After save, AI auto-fill runs
            in the background — refresh /admin in ~30s to see filled fields.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-neutral-700 hover:text-black"
        >
          ← Back to products
        </Link>
      </div>
      <BulkCreateForm
        itemTypeOptions={itemTypeOptions}
        roomOptions={roomOptions}
        subtypesByItemType={subtypesByItemType}
      />
    </div>
  );
}
