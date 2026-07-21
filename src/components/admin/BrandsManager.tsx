"use client";

/**
 * Settings → Brand. Lists the brands table, adds a new one (through the casing
 * gate) and deletes a row.
 *
 * Delete removes the BRAND ROW only — never the brand string sitting on any
 * product. So the confirm copy is explicit about that: it stops the brand
 * being offered in the picker; it does not rename or blank any product.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addBrandAction,
  deleteBrandAction,
} from "@/app/admin/(dashboard)/settings/brand-actions";
import type { BrandRow } from "@/lib/admin/brands";

export default function BrandsManager({ brands }: { brands: BrandRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function add() {
    const name = input.trim();
    if (!name) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await addBrandAction(name);
      if (res.ok) {
        setInput("");
        setNotice(`Added "${res.brand.name}".`);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  function remove(b: BrandRow) {
    if (
      !confirm(
        `Delete brand "${b.name}"?\n\nThis removes it from the brand picker only. Products already using "${b.name}" keep that value — nothing is renamed.`,
      )
    ) {
      return;
    }
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await deleteBrandAction(b.id);
      if (res.ok) {
        setNotice(`Deleted "${b.name}".`);
        router.refresh();
      } else {
        setError(res.error ?? "Delete failed.");
      }
    });
  }

  return (
    <div className="max-w-xl">
      <p className="mb-4 text-sm text-neutral-500">
        Brands offered in the product brand picker. Adding runs the casing gate
        (type <span className="font-mono">saniware</span>, stores{" "}
        <span className="font-mono">SANIWARE</span>). Deleting only removes the
        option — products keep their existing brand value.
      </p>

      <div className="mb-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="New brand name"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-1.5 text-sm outline-none focus:border-sky-400"
        />
        <button
          type="button"
          onClick={add}
          disabled={pending || input.trim() === ""}
          className="rounded-md bg-black px-4 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {error && <div className="mb-3 text-sm text-rose-700">{error}</div>}
      {notice && <div className="mb-3 text-sm text-emerald-700">{notice}</div>}

      <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
          {brands.length} brand{brands.length === 1 ? "" : "s"}
        </div>
        {brands.length === 0 ? (
          <div className="px-4 py-6 text-sm text-neutral-400">
            No brands yet — add one above.
          </div>
        ) : (
          <ul>
            {brands.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between border-b border-neutral-100 px-4 py-2 text-sm last:border-0"
              >
                <span>{b.name}</span>
                <button
                  type="button"
                  onClick={() => remove(b)}
                  disabled={pending}
                  className="rounded px-2 py-1 text-xs text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
