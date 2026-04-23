import { loadTaxonomy } from "@/lib/taxonomy";
import { addTaxonomyItem, addSubtype } from "./actions";
import AutoTranslateButton from "./AutoTranslateButton";
import DeleteChip from "./DeleteChip";
import SubtypeChip from "./SubtypeChip";

export const dynamic = "force-dynamic";

type SearchParams = {
  added?: string;
  deleted?: string;
  translated?: string;
  err?: string;
  kind?: string;
  msg?: string;
  slug?: string;
  count?: string;
};

type PageProps = { searchParams: Promise<SearchParams> };

/** Count of rows missing at least one of label_zh / label_ms, across every
 *  taxonomy kind. Drives the "Auto-translate (N)" button label. */
function countMissing(
  rows: { label_zh: string | null; label_ms: string | null }[],
): number {
  let n = 0;
  for (const r of rows) {
    if (r.label_zh == null || r.label_ms == null) n += 1;
  }
  return n;
}

export default async function TaxonomyPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tx = await loadTaxonomy();

  const missingCount =
    countMissing(tx.itemTypes) +
    countMissing(tx.itemSubtypes) +
    countMissing(tx.rooms) +
    countMissing(tx.styles) +
    countMissing(tx.materials) +
    countMissing(tx.colors) +
    countMissing(tx.regions);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Taxonomy</h1>
          <p className="mt-1 text-sm text-neutral-600">
            Manage items, rooms, styles, materials, and colors here.
            Anything added shows up in the product form immediately.
          </p>
          <p className="mt-1 text-xs text-neutral-500">
            English is the source of truth. Chinese + Malay are
            translations, filled by OpenAI GPT-4o-mini via the button
            on the right.
          </p>
        </div>
        <AutoTranslateButton missingCount={missingCount} />
      </header>

      {(sp.added || sp.deleted) && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {sp.added ? `Added (${sp.added})` : `Deleted (${sp.deleted})`}
        </div>
      )}
      {sp.translated != null && (
        <div className="rounded-md bg-sky-50 px-4 py-2 text-sm text-sky-700">
          {sp.translated === "0"
            ? "Nothing to translate — every row already has Chinese + Malay."
            : `Translated ${sp.translated} row(s). Public catalog refreshed.`}
        </div>
      )}
      {sp.err && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {errorMessage(sp.err, sp.kind, sp.msg, sp.slug, sp.count)}
        </div>
      )}

      <Block
        kind="item_types"
        title="Item types"
        hint="A product is one kind of thing · single-select"
        rows={tx.itemTypes.map((r) => ({
          slug: r.slug,
          label: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="rooms"
        title="Rooms / usage"
        hint="A product may belong to multiple rooms"
        rows={tx.rooms.map((r) => ({
          slug: r.slug,
          label: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="styles"
        title="Styles"
        hint="A product may have multiple styles"
        rows={tx.styles.map((r) => ({
          slug: r.slug,
          label: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="materials"
        title="Materials"
        hint="Multi-select"
        rows={tx.materials.map((r) => ({
          slug: r.slug,
          label: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="colors"
        title="Colors"
        hint="Multi-select · with hex value"
        rows={tx.colors.map((r) => ({
          slug: r.slug,
          label: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
          hex: r.hex,
        }))}
      />

      <SubtypesBlock
        itemTypes={tx.itemTypes.map((r) => ({ slug: r.slug, label: r.label_en }))}
        rooms={tx.rooms.map((r) => ({ slug: r.slug, label: r.label_en }))}
        subtypes={tx.itemSubtypes.map((s) => ({
          slug: s.slug,
          item_type_slug: s.item_type_slug,
          room_slug: s.room_slug,
          label_en: s.label_en,
          label_zh: s.label_zh,
          label_ms: s.label_ms,
        }))}
      />

      <RegionsBlock
        regions={tx.regions.map((r) => ({
          slug: r.slug,
          label_en: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
          region: r.region,
        }))}
      />
    </div>
  );
}

// ─── Subtypes ──────────────────────────────────────────────────────
//
// Subtypes have an extra dimension over the other taxonomy tables
// — they belong to an item_type AND own a room. Render them grouped
// by item_type so the operator can see "what does TV cabinet have
// today" at a glance, with an inline add-form that prefills the
// item_type for that group.

type SubtypeRow = {
  slug: string;
  item_type_slug: string;
  room_slug: string;
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
};

function SubtypesBlock({
  itemTypes,
  rooms,
  subtypes,
}: {
  itemTypes: { slug: string; label: string }[];
  rooms: { slug: string; label: string }[];
  subtypes: SubtypeRow[];
}) {
  const byItemType = new Map<string, SubtypeRow[]>();
  for (const s of subtypes) {
    const arr = byItemType.get(s.item_type_slug) ?? [];
    arr.push(s);
    byItemType.set(s.item_type_slug, arr);
  }

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Item subtypes
        </h2>
        <span className="text-xs text-neutral-400">
          Optional drill-down on an item type · subtype owns its own room
        </span>
      </div>

      {itemTypes.length === 0 ? (
        <div className="text-xs text-neutral-400">
          (No item types yet — add some above first.)
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {itemTypes.map((it) => {
            const subs = byItemType.get(it.slug) ?? [];
            return (
              <div key={it.slug} className="border-l-2 border-neutral-200 pl-4">
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-sm font-medium text-neutral-800">
                    {it.label}
                  </span>
                  <span className="text-[11px] text-neutral-400">
                    ({it.slug}) · {subs.length} subtype(s)
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {subs.length === 0 && (
                    <span className="text-xs text-neutral-400">
                      (none — products will use the item type&rsquo;s room)
                    </span>
                  )}
                  {subs.map((s) => (
                    <SubtypeChip
                      key={`${s.item_type_slug}::${s.slug}`}
                      itemTypeSlug={s.item_type_slug}
                      slug={s.slug}
                      label={s.label_en}
                      roomSlug={s.room_slug}
                      labelZh={s.label_zh}
                      labelMs={s.label_ms}
                    />
                  ))}
                </div>
                <form
                  action={addSubtype}
                  className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_180px_auto]"
                >
                  <input
                    type="hidden"
                    name="item_type_slug"
                    value={it.slug}
                  />
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-600">
                      Label (en) *
                    </span>
                    <input
                      name="label_en"
                      required
                      placeholder="e.g. Floating"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-600">
                      slug (auto)
                    </span>
                    <input
                      name="slug"
                      placeholder="a-z 0-9 _"
                      pattern="[a-z0-9_]+"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-600">
                      Room (subtype-owned) *
                    </span>
                    <select
                      name="room_slug"
                      required
                      defaultValue={rooms[0]?.slug ?? ""}
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-black focus:outline-none"
                    >
                      {rooms.map((r) => (
                        <option key={r.slug} value={r.slug}>
                          {r.label} ({r.slug})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Add
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Regions ───────────────────────────────────────────────────────
//
// Regions are seeded by migration 0011 — the operator can't add /
// remove them (Malaysia has a fixed 13 states + 3 federal territories)
// but they need translation visibility, so render them read-only with
// the same ZH/MS missing-indicator as the other blocks.

type RegionRow = {
  slug: string;
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
  region: string;
};

const REGION_GROUP_LABELS: Record<string, string> = {
  north: "Northern",
  central: "Central",
  south: "Southern",
  east: "East Coast",
  sabah_sarawak: "East Malaysia",
};
const REGION_GROUP_ORDER = [
  "north",
  "central",
  "south",
  "east",
  "sabah_sarawak",
];

function RegionsBlock({ regions }: { regions: RegionRow[] }) {
  const byGroup = new Map<string, RegionRow[]>();
  for (const r of regions) {
    const arr = byGroup.get(r.region) ?? [];
    arr.push(r);
    byGroup.set(r.region, arr);
  }
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Store locations · 供应商门店所在地
        </h2>
        <span className="text-xs text-neutral-400">
          Read-only · seeded by migration 0011 (13 states + 3 FT)
        </span>
      </div>
      {regions.length === 0 ? (
        <div className="text-xs text-rose-600">
          No regions seeded — run migration 0011.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {REGION_GROUP_ORDER.map((g) => {
            const inGroup = byGroup.get(g) ?? [];
            if (!inGroup.length) return null;
            return (
              <div key={g}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
                  {REGION_GROUP_LABELS[g] ?? g}
                </div>
                <div className="flex flex-wrap gap-2">
                  {inGroup.map((r) => {
                    const bothMissing =
                      r.label_zh == null && r.label_ms == null;
                    return (
                      <div
                        key={r.slug}
                        className={`inline-flex flex-col rounded-md border px-2.5 py-1.5 text-xs ${
                          bothMissing
                            ? "border-amber-300 bg-amber-50"
                            : "border-neutral-300 bg-white"
                        }`}
                      >
                        <div className="font-medium">{r.label_en}</div>
                        <div className="mt-0.5 flex gap-2 text-[10px] leading-tight text-neutral-500">
                          <span
                            className={r.label_zh ? "" : "text-amber-600"}
                          >
                            ZH: {r.label_zh ?? "—"}
                          </span>
                          <span
                            className={r.label_ms ? "" : "text-amber-600"}
                          >
                            MS: {r.label_ms ?? "—"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function errorMessage(
  err: string,
  kind?: string,
  msg?: string,
  slug?: string,
  count?: string,
): string {
  switch (err) {
    case "label":
      return "Error: missing label";
    case "slug":
      return "Error: name must contain at least one ASCII letter/digit, or provide a slug manually (e.g. gamer_pc)";
    case "hex":
      return "Error: hex value must be #RRGGBB (e.g. #FF8800)";
    case "inuse":
      return `Can't delete: ${count ?? "?"} product(s) still reference "${slug ?? ""}". Reassign those products first, then retry.`;
    case "db":
      return kind === "translate"
        ? `Translation failed: ${msg ?? "unknown error"}`
        : `Database error (${kind}): ${msg ?? ""}`;
    default:
      return `Error: ${err}`;
  }
}

type Row = {
  slug: string;
  label: string;
  label_zh: string | null;
  label_ms: string | null;
  hex?: string;
};

function Block({
  kind,
  title,
  hint,
  rows,
}: {
  kind: "item_types" | "rooms" | "styles" | "materials" | "colors";
  title: string;
  hint: string;
  rows: Row[];
}) {
  const isColor = kind === "colors";
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h2>
        <span className="text-xs text-neutral-400">{hint}</span>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {rows.length === 0 && (
          <span className="text-xs text-neutral-400">(empty)</span>
        )}
        {rows.map((r) => (
          <DeleteChip
            key={r.slug}
            kind={kind}
            slug={r.slug}
            label={r.label}
            labelZh={r.label_zh}
            labelMs={r.label_ms}
            hex={r.hex}
          />
        ))}
      </div>

      <form
        action={addTaxonomyItem}
        className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto] lg:grid-cols-[1fr_1fr_120px_auto]"
      >
        <input type="hidden" name="kind" value={kind} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-600">Label (en) *</span>
          <input
            name="label_en"
            required
            placeholder="e.g. Gaming Desk"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-600">slug (optional, auto-generated)</span>
          <input
            name="slug"
            placeholder="a-z 0-9 _"
            pattern="[a-z0-9_]+"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </label>
        {isColor && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-neutral-600">hex *</span>
            <input
              name="hex"
              required
              placeholder="#FF8800"
              pattern="#[0-9A-Fa-f]{6}"
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
            />
          </label>
        )}
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Add
        </button>
      </form>
    </section>
  );
}
