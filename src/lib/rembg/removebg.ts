/**
 * Remove.bg-based rembg provider — the premium fallback.
 *
 * ~$0.20 per image (roughly 200× the cost of Replicate), but edges
 * and semi-transparent glass/hair come out noticeably cleaner. We
 * only reach for this when an operator rejects a Replicate cutout
 * on the review page ("redo with Remove.bg" button).
 *
 * API docs: https://www.remove.bg/api
 *   POST /v1.0/removebg
 *   multipart or JSON { image_url } → PNG binary
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

const ENDPOINT = "https://api.remove.bg/v1.0/removebg";

export class RemoveBgProvider implements RemBgProvider {
  readonly id = "removebg" as const;

  isConfigured(): boolean {
    return Boolean(process.env.REMOVEBG_API_KEY);
  }

  async run(req: RemBgRequest): Promise<RemBgResult> {
    if (!this.isConfigured()) {
      throw new RemBgProviderUnavailableError(this.id);
    }

    const reservation = await reserveSlot({
      service: this.id,
      productId: req.productId,
      productImageId: req.productImageId,
      note: `rembg (removebg): ${req.sourceUrl.slice(0, 200)}`,
    });

    try {
      // Remove.bg accepts image_url OR a file upload. URL is
      // simpler and lets us keep the raw image in our own private
      // bucket — but we need to sign a short-lived URL first
      // (callers pass a signed URL when the bucket is private).
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "X-Api-Key": process.env.REMOVEBG_API_KEY as string,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "image/png",
        },
        body: new URLSearchParams({
          image_url: req.sourceUrl,
          size: "auto",
          format: "png",
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `removebg failed: ${res.status} ${res.statusText} ${body.slice(0, 300)}`,
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
      if (err instanceof QuotaExceededError) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      await refundSlot(reservation, this.id, reason).catch(() => {});
      throw err;
    }
  }
}
