/**
 * Single source of truth for "is this an AI scene-cover URL?".
 *
 * A scene cover is a /scene- image produced by the scene-cover engine
 * (src/lib/scene-cover.ts writes `${id}/scene-${ts}.png` and points the
 * product's thumbnail_url at it). Everywhere that asks "does this product have
 * a scene?" reads it off the URL — the cheap, queryable proxy shared by #21's
 * Regenerate idempotency, the admin list's scene chip, CategoryProgress's
 * `场景 X/Y` count, and the publish gate. ONE function so those can never
 * drift apart (they used to inline `(url ?? "").includes("/scene-")` in five
 * places).
 *
 * Deliberately dependency-free (no "server-only", no sharp) so it can be
 * imported by the gate loaders, server components, and scene-cover.ts alike.
 */
export function isSceneCoverUrl(url: string | null | undefined): boolean {
  return (url ?? "").includes("/scene-");
}
