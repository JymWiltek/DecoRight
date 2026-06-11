import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createBundleAction } from "../actions";

/** Wave 10 — new bundle form. Slug auto-derived from name if blank.
 *  Products can be entered as space/comma-separated UUIDs (admin
 *  copy-pastes from the product list); a richer picker UI ships
 *  with the designer front-end. */
export default async function NewBundlePage({
  searchParams,
}: {
  searchParams?: Promise<{ err?: string; msg?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};

  return (
    <div className="mx-auto max-w-2xl p-6">
      <Link
        href="/admin/bundles"
        className="text-sm text-sky-700 hover:underline"
      >
        ← Bundles
      </Link>
      <h1 className="mt-3 text-xl font-semibold">New bundle</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Curated product pack the designer pays one credit price for.
        Add products by pasting their UUIDs here, or attach them later
        from the bundle detail page.
      </p>

      {sp.err && (
        <div className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <strong>{sp.err}</strong>: {sp.msg ?? ""}
        </div>
      )}

      <form action={createBundleAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Name
          </label>
          <input
            name="name"
            required
            placeholder="Black Bathroom Series"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Slug (optional — auto from name)
          </label>
          <input
            name="slug"
            placeholder="black-bathroom-series"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Description (optional)
          </label>
          <textarea
            name="description"
            rows={2}
            placeholder="Short pitch shown to designers."
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Credit cost
          </label>
          <input
            name="credit_cost"
            type="number"
            required
            min={0}
            placeholder="30"
            className="mt-1 w-32 rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Product IDs (space or comma separated, optional)
          </label>
          <textarea
            name="product_ids"
            rows={3}
            placeholder="uuid1 uuid2 uuid3"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Cover image URL (optional)
          </label>
          <input
            name="cover_image_url"
            type="url"
            placeholder="https://…"
            className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create bundle
          </button>
        </div>
      </form>
    </div>
  );
}
