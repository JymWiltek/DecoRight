"use client";

/**
 * Server-side search box for /admin. Submits q as a URL query param;
 * the page component (server component) reads it and passes to
 * listAllProducts which runs an ilike across name/brand/item_type.
 *
 * Debounced submit on type so the operator doesn't need to press
 * Enter — but Enter still works, and a "Clear" button resets to "".
 * Preserves all OTHER query params (sort, status filter) by snapshotting
 * useSearchParams at submit time.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SearchBar() {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(sp.get("q") ?? "");
  const debounceRef = useRef<number | null>(null);

  // Sync value when sp changes externally (e.g. clicking a status chip
  // in the header that resets q).
  useEffect(() => {
    setValue(sp.get("q") ?? "");
  }, [sp]);

  function pushWith(nextQ: string) {
    const params = new URLSearchParams(sp.toString());
    if (nextQ.trim()) params.set("q", nextQ.trim());
    else params.delete("q");
    router.push(`/admin?${params.toString()}`);
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => pushWith(v), 250);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    pushWith(value);
  }

  function clear() {
    setValue("");
    pushWith("");
  }

  return (
    <form onSubmit={onSubmit} className="relative w-full max-w-md">
      <input
        type="search"
        name="q"
        value={value}
        onChange={onChange}
        placeholder="Search by name, brand, item type…"
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 pr-9 text-sm focus:border-black focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
        >
          ✕
        </button>
      )}
    </form>
  );
}
