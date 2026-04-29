/**
 * Wave UI · Commit 3 — fetch Unsplash placeholder room covers,
 * upload to our `thumbnails` public bucket, and write the resulting
 * own-bucket URL into rooms.cover_url.
 *
 * Why this script exists:
 *   • Notion design's home Section 3 wants 6 image-led room cards.
 *   • Hot-linking Unsplash from production pages violates their ToS
 *     above casual prototyping volume — and bypasses our own CDN
 *     caching / locale-stable rendering.
 *   • Long-term, Jym replaces these with original photographs. The
 *     cover_url column doesn't care about source, only that we own
 *     the URL.
 *
 * Idempotent: safe to re-run. Each room slug maps to a fixed source
 * URL and a fixed bucket key (`room-covers/<slug>.jpg`). `upsert: true`
 * on the upload overwrites the existing object, and the DB write
 * always sets cover_url to the public URL — no stale-skip path.
 *
 * Run: `npx tsx --env-file=.env.local scripts/seed-room-covers.ts`
 *
 * Env required:
 *   - NEXT_PUBLIC_APP_SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 */
import { createServiceRoleClient } from "../src/lib/supabase/service";

type RoomCoverSeed = {
  slug: string;
  /** Direct image URL from Unsplash (license: free, attribution
   *  encouraged but not required). When Jym shoots real photos we
   *  point this at the new public URL and re-run, no schema change. */
  sourceUrl: string;
  /** What the photo depicts — used in the alt text written nowhere
   *  yet, kept for documentation. */
  description: string;
};

/**
 * Notion design's six "primary" rooms (the ones the home grid
 * promotes). Other rooms in the table (Curtain, Decor, Door, …)
 * keep cover_url = NULL and the FE falls back to a typographic
 * gradient tile. That's intentional — those are legacy quasi-rooms
 * that overlap with item types, and the design doesn't push them.
 */
const SEEDS: RoomCoverSeed[] = [
  {
    slug: "living_room",
    sourceUrl:
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=1200&auto=format&fit=crop&q=70",
    description: "Modern living room with neutral palette",
  },
  {
    slug: "dining_room",
    sourceUrl:
      "https://images.unsplash.com/photo-1617806118233-18e1de247200?w=1200&auto=format&fit=crop&q=70",
    description: "Dining room with wooden table and chairs",
  },
  {
    slug: "kitchen",
    sourceUrl:
      "https://images.unsplash.com/photo-1556909114-f6e7ad7d3136?w=1200&auto=format&fit=crop&q=70",
    description: "Bright kitchen with island and white cabinets",
  },
  {
    slug: "bedroom",
    sourceUrl:
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=1200&auto=format&fit=crop&q=70",
    description: "Calm bedroom with linen bedding",
  },
  {
    slug: "bathroom",
    sourceUrl:
      "https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=1200&auto=format&fit=crop&q=70",
    description: "Modern bathroom with freestanding tub",
  },
  // balcony: intentionally omitted. Three Unsplash IDs in a row returned
  // wrong subjects (apple pie / co-working space / interior sofa) — the
  // search index there is unreliable for "balcony" queries. Rather than
  // ship a misleading photo, leave cover_url NULL so RoomCard falls back
  // to the typographic gradient tile. Replace with a real shot when
  // available (Jym to source) and re-add the seed entry.
];

const BUCKET = "thumbnails";

async function main() {
  const supabase = createServiceRoleClient();

  let ok = 0;
  let failed = 0;

  for (const seed of SEEDS) {
    const key = `room-covers/${seed.slug}.jpg`;
    process.stdout.write(`[${seed.slug}] fetch ${seed.sourceUrl} ... `);
    try {
      const resp = await fetch(seed.sourceUrl, {
        // Set a UA — some CDNs serve different content (or 403)
        // when the request comes from an unidentified Node fetch.
        headers: { "User-Agent": "decoright-seed/1.0" },
      });
      if (!resp.ok) {
        console.log(`✗ HTTP ${resp.status}`);
        failed++;
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const upload = await supabase.storage
        .from(BUCKET)
        .upload(key, buf, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: "31536000", // 1y; we cache-bust via ?v= when needed
        });
      if (upload.error) {
        console.log(`✗ upload: ${upload.error.message}`);
        failed++;
        continue;
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
      const publicUrl = data.publicUrl;
      const update = await supabase
        .from("rooms")
        .update({ cover_url: publicUrl })
        .eq("slug", seed.slug);
      if (update.error) {
        console.log(`✗ DB: ${update.error.message}`);
        failed++;
        continue;
      }
      console.log(`✓ ${publicUrl}`);
      ok++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`✗ ${msg}`);
      failed++;
    }
  }

  console.log(`\nDone — ${ok}/${SEEDS.length} ok, ${failed} failed.`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
