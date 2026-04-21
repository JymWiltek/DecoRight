/**
 * Provider-agnostic interface for "remove background from one image".
 *
 * Implementations:
 *   - ReplicateProvider (primary, ~$0.001/call)
 *   - RemoveBgProvider  (fallback, ~$0.20/call, better edges)
 *
 * The wrapper in ./index.ts picks a provider by name, but callers can
 * also be explicit — e.g. the "rerun with Remove.bg" action on the
 * cutout review page.
 */

export type RemBgProviderId = "replicate_rembg" | "removebg";

export type RemBgRequest = {
  /** Public URL of the raw image the provider should fetch. */
  sourceUrl: string;
  /** For API-usage audit rows. Optional but recommended. */
  productId?: string | null;
  productImageId?: string | null;
};

export type RemBgResult = {
  /** Raw bytes of the cut-out PNG (with alpha). Caller uploads to Storage. */
  bytes: Uint8Array;
  /** MIME type — always "image/png" in practice. */
  contentType: string;
  /** Which provider handled this, for the audit trail. */
  provider: RemBgProviderId;
  /** What the provider actually cost us (sourced from app_config). */
  costUsd: number;
};

export interface RemBgProvider {
  readonly id: RemBgProviderId;
  /** True iff required env vars are present. Callers degrade when false. */
  isConfigured(): boolean;
  run(req: RemBgRequest): Promise<RemBgResult>;
}

export class RemBgProviderUnavailableError extends Error {
  constructor(public providerId: RemBgProviderId) {
    super(`rembg provider "${providerId}" is not configured`);
    this.name = "RemBgProviderUnavailableError";
  }
}
