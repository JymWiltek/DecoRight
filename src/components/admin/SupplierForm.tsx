import { SUPPLIER_TYPES } from "@/lib/constants/enums";
import { SUPPLIER_TYPE_LABELS } from "@/lib/constants/enum-labels";
import type { RegionRow, SupplierRow } from "@/lib/supabase/types";

/**
 * Mig 0048 — shared create/edit supplier form. Plain server-rendered
 * <form> (no client JS): checkboxes named region_slugs let FormData
 * .getAll() collect covered states, mirroring the products store_locations
 * pattern. The parent passes the bound server action (create or update).
 */
export default function SupplierForm({
  action,
  regions,
  supplier,
}: {
  action: (fd: FormData) => void | Promise<void>;
  regions: RegionRow[];
  supplier?: SupplierRow | null;
}) {
  const s = supplier;
  const covered = new Set(s?.region_slugs ?? []);
  const input =
    "mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm";
  const label = "block text-xs font-medium uppercase text-neutral-500";

  return (
    <form action={action} className="space-y-4">
      {s && <input type="hidden" name="id" value={s.id} />}
      <div>
        <label className={label}>Name *</label>
        <input
          name="name"
          type="text"
          required
          defaultValue={s?.name ?? ""}
          placeholder="e.g. Wiltek Sanitary"
          className={input}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={label}>Type</label>
          <select name="type" defaultValue={s?.type ?? "store"} className={input}>
            {SUPPLIER_TYPES.map((t) => (
              <option key={t} value={t}>
                {SUPPLIER_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>WhatsApp (MY number)</label>
          <input
            name="whatsapp"
            type="text"
            defaultValue={s?.whatsapp ?? ""}
            placeholder="60123456789"
            className={input}
          />
        </div>
      </div>
      <div>
        <label className={label}>Website URL</label>
        <input
          name="website_url"
          type="url"
          defaultValue={s?.website_url ?? ""}
          placeholder="https://…"
          className={input}
        />
      </div>
      <div>
        <label className={label}>Logo URL</label>
        <input
          name="logo_url"
          type="url"
          defaultValue={s?.logo_url ?? ""}
          placeholder="https://… (optional)"
          className={input}
        />
      </div>
      <div>
        <label className={label}>Covered states</label>
        <p className="mt-1 text-[11px] text-neutral-400">
          Selecting this supplier on a product auto-adds these states to the
          product&apos;s store locations.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          {regions.map((r) => (
            <label
              key={r.slug}
              className="flex items-center gap-2 text-sm text-neutral-700"
            >
              <input
                type="checkbox"
                name="region_slugs"
                value={r.slug}
                defaultChecked={covered.has(r.slug)}
                className="h-4 w-4 rounded border-neutral-300"
              />
              {r.label_en}
            </label>
          ))}
        </div>
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          {s ? "Save supplier" : "Create supplier"}
        </button>
      </div>
    </form>
  );
}
