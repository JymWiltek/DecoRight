"use client";

/**
 * Mig 0048 — product↔supplier multi-select with per-channel fields.
 *
 * The operator ticks suppliers (from the admin-curated list — NOT free
 * text) and, per ticked supplier, sets this channel's price / stock /
 * buy link / store address / exclusivity. Selection serializes into a
 * single hidden <input name="product_suppliers_json"> (form={FORM_ID});
 * updateProduct parses it and replaces the product's product_suppliers
 * rows. Ticking a supplier also dispatches its covered states to
 * RegionsPicker so the product's store_locations auto-fill.
 */

import { useMemo, useState } from "react";
import type { SupplierRow, ProductSupplierRow } from "@/lib/supabase/types";
import { STOCK_STATUSES } from "@/lib/constants/enums";
import {
  STOCK_STATUS_LABELS,
  SUPPLIER_TYPE_LABELS,
} from "@/lib/constants/enum-labels";
import { ADD_REGIONS_EVENT } from "./RegionsPicker";

type Link = {
  supplier_id: string;
  price_myr: string;
  stock_status: (typeof STOCK_STATUSES)[number];
  buy_url: string;
  store_address: string;
  is_exclusive: boolean;
};

type Props = {
  form: string;
  suppliers: SupplierRow[];
  /** Existing product_suppliers rows for this product (edit page). */
  initial: ProductSupplierRow[];
};

export default function SuppliersPicker({ form, suppliers, initial }: Props) {
  const byId = useMemo(
    () => new Map(suppliers.map((s) => [s.id, s])),
    [suppliers],
  );
  const [links, setLinks] = useState<Map<string, Link>>(() => {
    const m = new Map<string, Link>();
    for (const r of initial) {
      m.set(r.supplier_id, {
        supplier_id: r.supplier_id,
        price_myr: r.price_myr != null ? String(r.price_myr) : "",
        stock_status: r.stock_status,
        buy_url: r.buy_url ?? "",
        store_address: r.store_address ?? "",
        is_exclusive: r.is_exclusive,
      });
    }
    return m;
  });

  function emitRegions(supplierId: string) {
    const cov = byId.get(supplierId)?.region_slugs ?? [];
    if (cov.length === 0) return;
    window.dispatchEvent(
      new CustomEvent<string[]>(ADD_REGIONS_EVENT, { detail: cov }),
    );
  }

  function toggle(supplierId: string) {
    setLinks((prev) => {
      const next = new Map(prev);
      if (next.has(supplierId)) {
        next.delete(supplierId);
      } else {
        next.set(supplierId, {
          supplier_id: supplierId,
          price_myr: "",
          stock_status: "in_stock",
          buy_url: "",
          store_address: "",
          is_exclusive: false,
        });
        emitRegions(supplierId); // auto-fill covered states
      }
      return next;
    });
  }

  function patch(supplierId: string, p: Partial<Link>) {
    setLinks((prev) => {
      const cur = prev.get(supplierId);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(supplierId, { ...cur, ...p });
      return next;
    });
  }

  // Serialize for the server: numbers parsed, empties → null.
  const payload = [...links.values()].map((l) => ({
    supplier_id: l.supplier_id,
    price_myr: l.price_myr.trim() === "" ? null : Number(l.price_myr),
    stock_status: l.stock_status,
    buy_url: l.buy_url.trim() || null,
    store_address: l.store_address.trim() || null,
    is_exclusive: l.is_exclusive,
  }));

  if (suppliers.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-xs text-neutral-500">
        No suppliers yet.{" "}
        <a href="/admin/suppliers/new" className="text-sky-700 underline">
          Create one
        </a>{" "}
        first, then come back to link it.
      </div>
    );
  }

  const fieldCls =
    "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800";

  return (
    <div className="flex flex-col gap-2">
      <input
        form={form}
        type="hidden"
        name="product_suppliers_json"
        value={JSON.stringify(payload)}
      />
      <div className="text-xs text-neutral-500">
        {links.size} supplier{links.size === 1 ? "" : "s"} linked. Tick a
        supplier to sell this product through it; its covered states auto-add
        to Store locations below.
      </div>
      <div className="flex flex-col gap-2">
        {suppliers.map((s) => {
          const link = links.get(s.id);
          const on = !!link;
          return (
            <div
              key={s.id}
              className={`rounded-md border p-2.5 transition ${
                on ? "border-black bg-neutral-50" : "border-neutral-200 bg-white"
              }`}
            >
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(s.id)}
                  className="h-4 w-4 rounded border-neutral-300"
                  data-testid={`supplier-toggle-${s.id}`}
                />
                <span className="text-sm font-medium text-neutral-800">
                  {s.name}
                </span>
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">
                  {SUPPLIER_TYPE_LABELS[s.type]}
                </span>
                {s.region_slugs.length > 0 && (
                  <span className="text-[10px] text-neutral-400">
                    {s.region_slugs.length} state
                    {s.region_slugs.length === 1 ? "" : "s"}
                  </span>
                )}
              </label>

              {on && link && (
                <div className="mt-2 grid grid-cols-2 gap-2 pl-6">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase text-neutral-500">
                      Price (MYR)
                    </span>
                    <input
                      type="number"
                      step="0.01"
                      value={link.price_myr}
                      onChange={(e) =>
                        patch(s.id, { price_myr: e.target.value })
                      }
                      placeholder="this channel's price"
                      className={fieldCls}
                      data-testid={`supplier-price-${s.id}`}
                    />
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase text-neutral-500">
                      Stock
                    </span>
                    <select
                      value={link.stock_status}
                      onChange={(e) =>
                        patch(s.id, {
                          stock_status: e.target
                            .value as Link["stock_status"],
                        })
                      }
                      className={fieldCls}
                    >
                      {STOCK_STATUSES.map((st) => (
                        <option key={st} value={st}>
                          {STOCK_STATUS_LABELS[st]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase text-neutral-500">
                      Buy URL
                    </span>
                    <input
                      type="url"
                      value={link.buy_url}
                      onChange={(e) => patch(s.id, { buy_url: e.target.value })}
                      placeholder="https://… (this channel's product link)"
                      className={fieldCls}
                    />
                  </label>
                  <label className="col-span-2 flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase text-neutral-500">
                      Store address
                    </span>
                    <input
                      type="text"
                      value={link.store_address}
                      onChange={(e) =>
                        patch(s.id, { store_address: e.target.value })
                      }
                      placeholder="physical store address (optional)"
                      className={fieldCls}
                    />
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-xs text-neutral-700">
                    <input
                      type="checkbox"
                      checked={link.is_exclusive}
                      onChange={(e) =>
                        patch(s.id, { is_exclusive: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-neutral-300"
                    />
                    Exclusive to this store
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
