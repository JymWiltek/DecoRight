"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { invalidateTaxonomyCache } from "@/lib/taxonomy";

type TaxonomyKind = "item_types" | "rooms" | "styles" | "materials" | "colors";

const VALID_KINDS: TaxonomyKind[] = [
  "item_types",
  "rooms",
  "styles",
  "materials",
  "colors",
];

function slugify(input: string): string {
  // Always normalize: lowercase, ASCII-only, collapse everything else to `_`.
  // Runs on both the label fallback AND any user-typed slug — we never
  // "reject for format", we just clean it up silently.
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function kindFromForm(fd: FormData): TaxonomyKind {
  const raw = fd.get("kind")?.toString() ?? "";
  if (!(VALID_KINDS as string[]).includes(raw)) {
    throw new Error(`invalid kind: ${raw}`);
  }
  return raw as TaxonomyKind;
}

export async function addTaxonomyItem(fd: FormData): Promise<void> {
  const kind = kindFromForm(fd);
  const label = fd.get("label_zh")?.toString().trim() ?? "";
  const slugRaw = fd.get("slug")?.toString().trim() ?? "";
  const hex = fd.get("hex")?.toString().trim() ?? "";

  if (!label) {
    redirect(`/admin/taxonomy?err=label&kind=${kind}`);
  }

  // Slugify whatever the user typed (or the label if they didn't type one).
  // We only bail if, AFTER cleaning, nothing printable is left — e.g. the
  // label was pure Chinese with no ASCII at all.
  const slug = slugify(slugRaw || label);
  if (!slug) {
    redirect(`/admin/taxonomy?err=slug&kind=${kind}`);
  }

  const supabase = createServiceRoleClient();

  if (kind === "colors") {
    if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      redirect(`/admin/taxonomy?err=hex&kind=${kind}`);
    }
    const { error } = await supabase
      .from("colors")
      .insert({ slug, label_zh: label, hex });
    if (error) {
      redirect(
        `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
      );
    }
  } else {
    const { error } = await supabase
      .from(kind)
      .insert({ slug, label_zh: label });
    if (error) {
      redirect(
        `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
      );
    }
  }

  invalidateTaxonomyCache();
  revalidatePath("/admin/taxonomy");
  revalidatePath("/admin/products/new");
  revalidatePath("/");
  redirect(`/admin/taxonomy?added=${kind}`);
}

/** Count products that reference this taxonomy slug. Different kinds live
 *  in different product columns:
 *   - item_types → products.item_type (scalar, use eq)
 *   - rooms/styles/materials/colors → products.<col> (text[], use `cs` /
 *     "contains" which is Postgres `@>`)
 */
async function countProductsUsing(
  supabase: ReturnType<typeof createServiceRoleClient>,
  kind: TaxonomyKind,
  slug: string,
): Promise<number> {
  if (kind === "item_types") {
    const { count, error } = await supabase
      .from("products")
      .select("id", { count: "exact", head: true })
      .eq("item_type", slug);
    if (error) throw error;
    return count ?? 0;
  }
  // kind === "rooms" | "styles" | "materials" | "colors"
  // products.<kind> is a text[] column named the same as the taxonomy table.
  const column = kind; // "rooms" | "styles" | "materials" | "colors"
  const { count, error } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .contains(column, [slug]);
  if (error) throw error;
  return count ?? 0;
}

export async function deleteTaxonomyItem(fd: FormData): Promise<void> {
  const kind = kindFromForm(fd);
  const slug = fd.get("slug")?.toString() ?? "";
  if (!slug) return;

  const supabase = createServiceRoleClient();

  // Guardrail: refuse to delete if any product is still using this slug.
  // Otherwise we'd orphan data (e.g. product.materials still contains "brass"
  // but the `brass` row is gone → broken label lookups, broken filters).
  let inUse = 0;
  try {
    inUse = await countProductsUsing(supabase, kind, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    redirect(
      `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(msg)}`,
    );
  }
  if (inUse > 0) {
    redirect(
      `/admin/taxonomy?err=inuse&kind=${kind}&slug=${encodeURIComponent(slug)}&count=${inUse}`,
    );
  }

  const { error } = await supabase.from(kind).delete().eq("slug", slug);
  if (error) {
    redirect(
      `/admin/taxonomy?err=db&kind=${kind}&msg=${encodeURIComponent(error.message)}`,
    );
  }

  invalidateTaxonomyCache();
  revalidatePath("/admin/taxonomy");
  revalidatePath("/admin/products/new");
  revalidatePath("/");
  redirect(`/admin/taxonomy?deleted=${kind}`);
}
