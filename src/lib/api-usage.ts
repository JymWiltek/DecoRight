/**
 * Thin wrapper around the `reserve_api_slot(...)` Postgres function
 * that migration 0003 created. Every paid third-party API call in
 * this codebase MUST go through reserveSlot() first.
 *
 * Contract (see migration 0003 STEP 8):
 *   reserve_api_slot(service, product_id?, product_image_id?, note?)
 *   → (usage_id uuid, cost_usd numeric)
 *   raises if emergency_stop=true
 *   raises if today's usage would exceed <service>_daily_limit
 *   inserts an api_usage row eagerly (we bill on reservation)
 *
 * On success, call billSlot() with the final status ("ok"|"error"|
 * "timeout"|...) so we update the row. On failure — before the paid
 * call lands — call refundSlot() which inserts a negative-cost
 * row so the running total self-heals.
 *
 * Why an advisory lock on the DB side: N parallel workers all
 * reading count(*) and then inserting would race past the cap.
 * Advisory lock serializes the check-and-insert atomically per
 * service.
 */
import { createServiceRoleClient } from "@/lib/supabase/service";
import type { ApiService } from "@/lib/supabase/types";

export type SlotReservation = {
  usageId: string;
  costUsd: number;
};

export type ReserveInput = {
  service: ApiService;
  productId?: string | null;
  productImageId?: string | null;
  note?: string | null;
};

export class QuotaExceededError extends Error {
  constructor(
    public service: ApiService,
    public cause: string,
  ) {
    super(`API quota blocked for ${service}: ${cause}`);
    this.name = "QuotaExceededError";
  }
}

/**
 * Reserve one unit of quota + insert a pending api_usage row.
 * Throws QuotaExceededError if emergency_stop is on or cap is
 * reached. Throws a plain Error for anything else.
 */
export async function reserveSlot(
  input: ReserveInput,
): Promise<SlotReservation> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("reserve_api_slot", {
    p_service: input.service,
    p_product_id: input.productId ?? null,
    p_product_image_id: input.productImageId ?? null,
    p_note: input.note ?? null,
  });

  if (error) {
    // Postgres raises EXCEPTION for quota/emergency-stop; surface as
    // a typed error so callers can render a friendly message.
    const msg = error.message ?? String(error);
    if (
      msg.includes("emergency_stop") ||
      msg.includes("daily_limit") ||
      msg.includes("quota")
    ) {
      throw new QuotaExceededError(input.service, msg);
    }
    throw error;
  }

  const row = (data ?? [])[0];
  if (!row) {
    throw new Error(`reserve_api_slot returned no row for ${input.service}`);
  }
  return { usageId: row.usage_id, costUsd: Number(row.cost_usd) };
}

/** Update the reserved row's status + optional note post-call. */
export async function billSlot(
  usageId: string,
  status: "ok" | "error" | "timeout" | "rejected",
  note?: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const patch: { status: string; note?: string } = { status };
  if (note !== undefined) patch.note = note.slice(0, 500);
  const { error } = await supabase
    .from("api_usage")
    .update(patch)
    .eq("id", usageId);
  if (error) throw error;
}

/**
 * If the paid call failed before any real money was spent (network
 * refused, key invalid, etc.), insert a compensating negative-cost
 * row so today's running total self-heals. The original reservation
 * stays as audit, marked status="refunded".
 */
export async function refundSlot(
  reservation: SlotReservation,
  service: ApiService,
  reason: string,
): Promise<void> {
  const supabase = createServiceRoleClient();
  const [{ error: insErr }, { error: updErr }] = await Promise.all([
    supabase.from("api_usage").insert({
      service,
      cost_usd: -reservation.costUsd,
      status: "refund",
      note: `refund for ${reservation.usageId}: ${reason}`.slice(0, 500),
    }),
    supabase
      .from("api_usage")
      .update({ status: "refunded", note: reason.slice(0, 500) })
      .eq("id", reservation.usageId),
  ]);
  if (insErr) throw insErr;
  if (updErr) throw updErr;
}

/**
 * Helper for the admin dashboard: how much have we spent today
 * per service, and what's the cap. Read-only.
 */
export async function todayUsageSummary(): Promise<
  Record<
    ApiService,
    { count: number; spentUsd: number; limit: number; blocked: boolean }
  >
> {
  const supabase = createServiceRoleClient();
  const startOfDayUtc = new Date();
  startOfDayUtc.setUTCHours(0, 0, 0, 0);

  const [{ data: rows, error: rowsErr }, { data: cfg, error: cfgErr }] =
    await Promise.all([
      supabase
        .from("api_usage")
        .select("service,cost_usd,status")
        .gte("created_at", startOfDayUtc.toISOString()),
      supabase.from("app_config").select("key,value"),
    ]);

  if (rowsErr) throw rowsErr;
  if (cfgErr) throw cfgErr;

  const cfgMap = new Map<string, string>(
    (cfg ?? []).map((r) => [r.key, r.value]),
  );
  const emergency = cfgMap.get("emergency_stop") === "true";

  const services: ApiService[] = ["replicate_rembg", "removebg", "meshy"];
  const out = {} as Record<
    ApiService,
    { count: number; spentUsd: number; limit: number; blocked: boolean }
  >;

  for (const s of services) {
    const limit = Number(cfgMap.get(`${s}_daily_limit`) ?? "0");
    const entries = (rows ?? []).filter((r) => r.service === s);
    // count = real positive-cost reservations (not refunds)
    const count = entries.filter((r) => Number(r.cost_usd) > 0).length;
    const spentUsd = entries.reduce((acc, r) => acc + Number(r.cost_usd), 0);
    out[s] = {
      count,
      spentUsd,
      limit,
      blocked: emergency || count >= limit,
    };
  }

  return out;
}
