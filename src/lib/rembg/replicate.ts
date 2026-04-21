/**
 * Replicate-based rembg provider.
 *
 * Model: `cjwbw/rembg` (u2net under the hood, standard for product
 * background removal). ~$0.001 per image, which is what we budget as
 * the default. Swap to another Replicate model later by changing the
 * MODEL_VERSION constant — the shape of input/output is stable.
 *
 * Replicate's prediction API is async, so we poll. Hard timeout at
 * 60s is enough for a 1MB product photo; if a render is still
 * pending after that, we treat it as a timeout error (the
 * reservation is refunded by the caller).
 */
import {
  QuotaExceededError,
  reserveSlot,
  billSlot,
  refundSlot,
} from "@/lib/api-usage";
import {
  RemBgProvider,
  RemBgProviderUnavailableError,
  RemBgRequest,
  RemBgResult,
} from "./types";

// Pinned Replicate model version. cjwbw/rembg is the most widely-used
// rembg model on Replicate. If you want to try a newer/better model
// (e.g. bria-rmbg-2.0), just swap this version hash.
const MODEL_VERSION =
  "fb8af171cfa1616ddcf1242c093f9c46bcada5ad4cf6f2fbe8b81b330ec5c003";

const POLL_INTERVAL_MS = 1500;
const MAX_WAIT_MS = 60_000;

type PredictionStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

type Prediction = {
  id: string;
  status: PredictionStatus;
  output?: string | null; // URL to the output PNG
  error?: string | null;
};

export class ReplicateProvider implements RemBgProvider {
  readonly id = "replicate_rembg" as const;

  isConfigured(): boolean {
    return Boolean(process.env.REPLICATE_API_TOKEN);
  }

  async run(req: RemBgRequest): Promise<RemBgResult> {
    if (!this.isConfigured()) {
      throw new RemBgProviderUnavailableError(this.id);
    }

    // Reserve quota BEFORE hitting the paid API — the reservation is
    // what the daily-limit math looks at. If we die between reserve
    // and call, the row stays (audit), but a manual ops step can
    // mark it refunded.
    const reservation = await reserveSlot({
      service: this.id,
      productId: req.productId,
      productImageId: req.productImageId,
      note: `rembg: ${req.sourceUrl.slice(0, 200)}`,
    });

    try {
      const prediction = await this.createPrediction(req.sourceUrl);
      const settled = await this.waitForPrediction(prediction.id);

      if (settled.status !== "succeeded" || !settled.output) {
        throw new Error(
          `replicate prediction ${settled.status}: ${settled.error ?? "no output"}`,
        );
      }

      // Output is a URL pointing at the cut-out PNG. Download it
      // into memory so the caller can upload to our own Storage
      // (Replicate's URL is short-lived).
      const res = await fetch(settled.output);
      if (!res.ok) {
        throw new Error(
          `replicate output download failed: ${res.status} ${res.statusText}`,
        );
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      await billSlot(reservation.usageId, "ok");

      return {
        bytes,
        contentType: "image/png",
        provider: this.id,
        costUsd: reservation.costUsd,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Quota errors shouldn't even reach here (they throw inside
      // reserveSlot), but guard anyway.
      if (err instanceof QuotaExceededError) throw err;
      await refundSlot(reservation, this.id, reason).catch(() => {});
      throw err;
    }
  }

  private async createPrediction(imageUrl: string): Promise<Prediction> {
    const res = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: MODEL_VERSION,
        input: { image: imageUrl },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `replicate create failed: ${res.status} ${res.statusText} ${body}`,
      );
    }
    return (await res.json()) as Prediction;
  }

  private async waitForPrediction(id: string): Promise<Prediction> {
    const deadline = Date.now() + MAX_WAIT_MS;
    let current: Prediction | null = null;
    while (Date.now() < deadline) {
      const res = await fetch(
        `https://api.replicate.com/v1/predictions/${id}`,
        {
          headers: {
            Authorization: `Token ${process.env.REPLICATE_API_TOKEN}`,
          },
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `replicate poll failed: ${res.status} ${res.statusText} ${body}`,
        );
      }
      current = (await res.json()) as Prediction;
      if (
        current.status === "succeeded" ||
        current.status === "failed" ||
        current.status === "canceled"
      ) {
        return current;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`replicate prediction ${id} timed out after 60s`);
  }
}
