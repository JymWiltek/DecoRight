import Link from "next/link";
import type { AdminProductSort } from "@/lib/admin/products";

/**
 * A clickable column header. Cycles asc → desc → off (for the same
 * column) on repeat clicks. Builds the next URL preserving all
 * existing query params except `sort`.
 *
 * Server component — sort state lives in the URL, no client JS needed
 * for the basic toggle. The arrow indicator + URL building is all
 * derivable from the current `sort` query param.
 */

type Direction = "asc" | "desc";

type Props = {
  /** Display label shown in the th. */
  label: string;
  /** The base name — `name`, `price`, `status`, `updated`. The
   *  generated sort values are `${baseName}_asc` / `${baseName}_desc`. */
  field: "name" | "price" | "status" | "updated";
  /** The current sort param from the URL (or default). */
  current: AdminProductSort;
  /** All current query params except sort, used to build the next URL. */
  preserveParams: Record<string, string | undefined>;
};

export default function SortableHeader({
  label,
  field,
  current,
  preserveParams,
}: Props) {
  const ascSort = `${field}_asc` as AdminProductSort;
  const descSort = `${field}_desc` as AdminProductSort;

  let active: Direction | null = null;
  if (current === ascSort) active = "asc";
  if (current === descSort) active = "desc";

  // Cycle: off → asc → desc → off (back to default = updated_desc).
  let nextSort: AdminProductSort | null;
  if (active == null) nextSort = ascSort;
  else if (active === "asc") nextSort = descSort;
  else nextSort = null; // off

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(preserveParams)) {
    if (v) params.set(k, v);
  }
  if (nextSort) params.set("sort", nextSort);
  else params.delete("sort");

  const arrow = active === "asc" ? " ↑" : active === "desc" ? " ↓" : "";

  return (
    <Link
      href={`/admin?${params.toString()}`}
      className={`inline-flex items-center hover:text-black ${
        active ? "text-black" : "text-neutral-500"
      }`}
    >
      {label}
      <span className="ml-1 text-[10px]">{arrow || " ↕"}</span>
    </Link>
  );
}
