/**
 * Storage-connectivity probe (PB). Jym's network drops the path to Supabase
 * for seconds-to-tens-of-seconds at a time; the byte-PUT then dies as a
 * TypeError (connection never established). This probe reflects THAT path so
 * the admin can be warned BEFORE Save — and so the retry logic can wait for
 * recovery instead of firing into a dead window.
 *
 * Client-safe (no "server-only"): imported by the StorageStatusBanner hook AND
 * by BulkCreateForm's retry gate.
 */

/** The URL whose reachability mirrors a signed byte-PUT: same Supabase Storage
 *  host, same DNS/TCP/TLS path. The object need not exist. */
function storageProbeUrl(): string | null {
  const base = process.env.NEXT_PUBLIC_APP_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/storage/v1/object/public/models/__connectivity_probe__`;
}

/**
 * Is the Supabase Storage host reachable from this browser right now?
 *
 * A `no-cors` GET RESOLVES (opaque) for ANY HTTP response — even a 404 for the
 * non-existent probe object — and REJECTS only on a network-layer failure
 * (TypeError), which is exactly the signature the failed PUTs showed. So a
 * resolve ⇒ the host/TCP/TLS path is up; a reject ⇒ it's down.
 *
 * LIMITATION (documented, per Jym): this tests REACHABILITY of the storage
 * host, not the signed-PUT authorization. A host that is reachable but would
 * reject a PUT (413 over-cap, expired signature, permission) still reads as
 * "connected" here — but those are 4xx HTTP responses that surface as clear
 * per-file errors, not the silent TypeError this probe exists to catch. When
 * the env var is missing we return true (can't probe ⇒ don't false-alarm).
 */
export async function probeStorageReachable(timeoutMs = 8000): Promise<boolean> {
  const url = storageProbeUrl();
  if (!url) return true;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    await fetch(`${url}?_=${Date.now()}`, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}
