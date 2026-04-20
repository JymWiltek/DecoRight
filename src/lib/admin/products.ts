import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ProductRow } from "@/lib/supabase/types";

export async function listAllProducts(): Promise<ProductRow[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
}

export async function getProductById(id: string): Promise<ProductRow | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("products")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
