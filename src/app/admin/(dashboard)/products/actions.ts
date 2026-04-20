"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { uploadGlb, uploadThumbnail } from "@/lib/storage";
import { inferProductFields } from "@/lib/ai/infer";
import {
  CATEGORIES,
  STYLES,
  PRIMARY_COLORS,
  MATERIALS,
  INSTALLATIONS,
  APPLICABLE_SPACES,
  PRICE_TIERS,
  PRODUCT_STATUSES,
  type Category,
  type Style,
  type PrimaryColor,
  type Material,
  type Installation,
  type ApplicableSpace,
  type PriceTier,
  type ProductStatus,
} from "@/lib/constants/enums";
import type {
  ColorVariant,
  Dimensions,
  ProductInsert,
  ProductUpdate,
} from "@/lib/supabase/types";

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

function pickMany<T extends readonly string[]>(
  fd: FormData,
  key: string,
  allowed: T,
): T[number][] {
  const raw = fd.getAll(key).map((x) => x.toString());
  return raw.filter((p): p is T[number] => (allowed as readonly string[]).includes(p));
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

function parseColorVariants(raw: string | null): ColorVariant[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v): ColorVariant | null => {
        if (!v || typeof v !== "object") return null;
        const name = typeof v.name === "string" ? v.name : null;
        const hex = typeof v.hex === "string" ? v.hex : null;
        if (!name || !hex) return null;
        return {
          name,
          hex,
          price_adjustment_myr:
            typeof v.price_adjustment_myr === "number" ? v.price_adjustment_myr : 0,
          purchase_url_override:
            typeof v.purchase_url_override === "string" && v.purchase_url_override
              ? v.purchase_url_override
              : null,
        };
      })
      .filter((x): x is ColorVariant => x !== null);
  } catch {
    return [];
  }
}

function parsePayload(fd: FormData): Omit<ProductInsert, "id"> {
  const category = pickOne(str(fd, "category"), CATEGORIES);
  if (!category) throw new Error("category required");
  const name = str(fd, "name");
  if (!name) throw new Error("name required");

  return {
    name,
    brand: str(fd, "brand"),
    category: category as Category,
    subcategory: str(fd, "subcategory"),
    style: pickOne(str(fd, "style"), STYLES) as Style | null,
    primary_color: pickOne(str(fd, "primary_color"), PRIMARY_COLORS) as PrimaryColor | null,
    material: pickOne(str(fd, "material"), MATERIALS) as Material | null,
    installation: pickOne(str(fd, "installation"), INSTALLATIONS) as Installation | null,
    applicable_space: pickMany(fd, "applicable_space", APPLICABLE_SPACES) as ApplicableSpace[],
    dimensions_mm: parseDimensions(fd),
    weight_kg: num(fd, "weight_kg"),
    price_myr: num(fd, "price_myr"),
    price_tier: pickOne(str(fd, "price_tier"), PRICE_TIERS) as PriceTier | null,
    color_variants: parseColorVariants(str(fd, "color_variants_json")),
    purchase_url: str(fd, "purchase_url"),
    supplier: str(fd, "supplier"),
    description: str(fd, "description"),
    status: (pickOne(str(fd, "status"), PRODUCT_STATUSES) as ProductStatus) ?? "draft",
    ai_filled_fields: fd.getAll("ai_filled_fields").map((x) => x.toString()),
  };
}

function fileOrNull(fd: FormData, key: string): File | null {
  const v = fd.get(key);
  if (v instanceof File && v.size > 0) return v;
  return null;
}

export async function createProduct(fd: FormData): Promise<void> {
  const payload = parsePayload(fd);
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
  redirect(`/admin/products/${id}/edit?saved=1`);
}

export async function updateProduct(id: string, fd: FormData): Promise<void> {
  const payload = parsePayload(fd);
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
  redirect(`/admin/products/${id}/edit?saved=1`);
}

export async function deleteProduct(id: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) throw error;
  revalidatePath("/admin");
  revalidatePath("/");
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
