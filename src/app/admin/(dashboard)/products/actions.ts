"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { uploadGlb, uploadThumbnail } from "@/lib/storage";
import { inferProductFields } from "@/lib/ai/infer";
import { invalidatePublishedCountsCache } from "@/lib/products";
import {
  PRICE_TIERS,
  PRODUCT_STATUSES,
  type PriceTier,
  type ProductStatus,
} from "@/lib/constants/enums";
import type {
  Dimensions,
  ProductInsert,
  ProductUpdate,
} from "@/lib/supabase/types";

// Taxonomy slugs are validated against the live DB tables — not a
// hard-coded list — so operators can add new item types / rooms /
// styles / colors / materials without a code change.
async function loadValidSlugs(): Promise<{
  itemTypes: Set<string>;
  styles: Set<string>;
  materials: Set<string>;
  colors: Set<string>;
}> {
  const supabase = createServiceRoleClient();
  const [it, st, mt, co] = await Promise.all([
    supabase.from("item_types").select("slug"),
    supabase.from("styles").select("slug"),
    supabase.from("materials").select("slug"),
    supabase.from("colors").select("slug"),
  ]);
  return {
    itemTypes: new Set((it.data ?? []).map((r) => r.slug)),
    styles: new Set((st.data ?? []).map((r) => r.slug)),
    materials: new Set((mt.data ?? []).map((r) => r.slug)),
    colors: new Set((co.data ?? []).map((r) => r.slug)),
  };
}

function str(fd: FormData, key: string): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function num(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickOne<T extends readonly string[]>(
  v: string | null,
  allowed: T,
): T[number] | null {
  if (!v) return null;
  return (allowed as readonly string[]).includes(v) ? (v as T[number]) : null;
}

function pickManyFromSet(
  fd: FormData,
  key: string,
  allowed: Set<string>,
): string[] {
  const raw = fd.getAll(key).map((x) => x.toString());
  return raw.filter((s) => allowed.has(s));
}

function pickOneFromSet(v: string | null, allowed: Set<string>): string | null {
  if (!v) return null;
  return allowed.has(v) ? v : null;
}

function parseDimensions(fd: FormData): Dimensions | null {
  const l = num(fd, "dim_length");
  const w = num(fd, "dim_width");
  const h = num(fd, "dim_height");
  if (l == null && w == null && h == null) return null;
  const out: Dimensions = {};
  if (l != null) out.length = l;
  if (w != null) out.width = w;
  if (h != null) out.height = h;
  return out;
}

async function parsePayload(fd: FormData): Promise<Omit<ProductInsert, "id">> {
  const valid = await loadValidSlugs();

  const name = str(fd, "name");
  if (!name) throw new Error("name required");

  return {
    name,
    brand: str(fd, "brand"),
    item_type: pickOneFromSet(str(fd, "item_type"), valid.itemTypes),
    styles: pickManyFromSet(fd, "styles", valid.styles),
    colors: pickManyFromSet(fd, "colors", valid.colors),
    materials: pickManyFromSet(fd, "materials", valid.materials),
    dimensions_mm: parseDimensions(fd),
    weight_kg: num(fd, "weight_kg"),
    price_myr: num(fd, "price_myr"),
    price_tier: pickOne(str(fd, "price_tier"), PRICE_TIERS) as PriceTier | null,
    purchase_url: str(fd, "purchase_url"),
    supplier: str(fd, "supplier"),
    description: str(fd, "description"),
    status:
      (pickOne(str(fd, "status"), PRODUCT_STATUSES) as ProductStatus) ?? "draft",
    ai_filled_fields: fd.getAll("ai_filled_fields").map((x) => x.toString()),
  };
}

function fileOrNull(fd: FormData, key: string): File | null {
  const v = fd.get(key);
  if (v instanceof File && v.size > 0) return v;
  return null;
}

export async function createProduct(fd: FormData): Promise<void> {
  const payload = await parsePayload(fd);
  const id = crypto.randomUUID();
  const supabase = createServiceRoleClient();

  let glb_url: string | null = null;
  let glb_size_kb: number | null = null;
  let thumbnail_url: string | null = null;

  const glb = fileOrNull(fd, "glb_file");
  if (glb) {
    glb_url = await uploadGlb(id, glb);
    glb_size_kb = Math.round(glb.size / 1024);
  }
  const thumb = fileOrNull(fd, "thumbnail_file");
  if (thumb) {
    thumbnail_url = await uploadThumbnail(id, thumb);
  }

  const { error } = await supabase
    .from("products")
    .insert({ id, ...payload, glb_url, glb_size_kb, thumbnail_url });
  if (error) throw error;

  revalidatePath("/admin");
  revalidatePath("/");
  invalidatePublishedCountsCache();
  redirect(`/admin/products/${id}/edit?saved=1`);
}

export async function updateProduct(id: string, fd: FormData): Promise<void> {
  const payload = await parsePayload(fd);
  const supabase = createServiceRoleClient();

  const updates: ProductUpdate = { ...payload };

  const glb = fileOrNull(fd, "glb_file");
  if (glb) {
    updates.glb_url = await uploadGlb(id, glb);
    updates.glb_size_kb = Math.round(glb.size / 1024);
  }
  const thumb = fileOrNull(fd, "thumbnail_file");
  if (thumb) {
    updates.thumbnail_url = await uploadThumbnail(id, thumb);
  }

  const { error } = await supabase.from("products").update(updates).eq("id", id);
  if (error) throw error;

  revalidatePath("/admin");
  revalidatePath("/");
  revalidatePath(`/product/${id}`);
  invalidatePublishedCountsCache();
  redirect(`/admin/products/${id}/edit?saved=1`);
}

export async function deleteProduct(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin");
  revalidatePath("/");
  invalidatePublishedCountsCache();
  redirect("/admin");
}

export async function runAiInfer(fd: FormData): Promise<{
  suggestedFields: Record<string, unknown>;
  inferredKeys: string[];
  note?: string;
}> {
  const result = await inferProductFields({
    name: str(fd, "name") ?? undefined,
    description: str(fd, "description") ?? undefined,
    brand: str(fd, "brand"),
  });
  return {
    suggestedFields: result.fields as Record<string, unknown>,
    inferredKeys: result.inferredKeys,
    note: result.note,
  };
}
