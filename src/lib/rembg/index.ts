/**
 * Single entry-point for background removal. Pick a provider
 * explicitly by id, or use getDefaultProvider() which picks
 * Replicate when configured and falls back to Remove.bg.
 */
import { ReplicateProvider } from "./replicate";
import { RemoveBgProvider } from "./removebg";
import type { RemBgProvider, RemBgProviderId } from "./types";

export type { RemBgProvider, RemBgProviderId, RemBgRequest, RemBgResult } from "./types";
export {
  RemBgProviderUnavailableError,
} from "./types";

const replicate = new ReplicateProvider();
const removebg = new RemoveBgProvider();

export function getProvider(id: RemBgProviderId): RemBgProvider {
  switch (id) {
    case "replicate_rembg":
      return replicate;
    case "removebg":
      return removebg;
  }
}

/**
 * Default provider for the "upload → auto-process" path.
 * Preference order:
 *   1. Replicate (cheap, the happy path)
 *   2. Remove.bg (if Replicate is not configured)
 * Returns null if neither key is set — caller shows a friendly
 * "please configure REPLICATE_API_TOKEN" hint instead of a 500.
 */
export function getDefaultProvider(): RemBgProvider | null {
  if (replicate.isConfigured()) return replicate;
  if (removebg.isConfigured()) return removebg;
  return null;
}

export function providerAvailability(): Record<RemBgProviderId, boolean> {
  return {
    replicate_rembg: replicate.isConfigured(),
    removebg: removebg.isConfigured(),
  };
}
