import { loadTaxonomy } from "@/lib/taxonomy";
import { addTaxonomyItem, addSubtype, setItemTypeRooms } from "./actions";
import AutoTranslateButton from "./AutoTranslateButton";
import DeleteChip from "./DeleteChip";
import SubtypeChip from "./SubtypeChip";
import TriLingualLabel from "@/components/admin/TriLingualLabel";

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

  // Pre-index the item_type_rooms M2M so each item_type block can
  // render its checkbox group without another pass over the array.
  const roomsByItemType = new Map<string, Set<string>>();
  for (const r of tx.itemTypeRooms) {
    const set = roomsByItemType.get(r.item_type_slug) ?? new Set<string>();
    set.add(r.room_slug);
    roomsByItemType.set(r.item_type_slug, set);
  }

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
            English is the source of truth. Chinese + Malay fill in via
            the Auto-translate button on the right, or click the ✎ on
            any chip to edit all three by hand. Migration 0013: Room ×
            Item Type × Subtype are three independent dimensions now.
          </p>
        </div>
        <AutoTranslateButton missingCount={missingCount} />
      </header>

      {(sp.added || sp.deleted) && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {sp.added ? `Saved (${sp.added})` : `Deleted (${sp.deleted})`}
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

      {/* F1: Item types — tri-lingual chip + M2M rooms editor per row. */}
      <ItemTypesBlock
        itemTypes={tx.itemTypes.map((r) => ({
          slug: r.slug,
          label: r.label_en,
          label_zh: r.label_zh,
          label_ms: r.label_ms,
        }))}
        rooms={tx.rooms.map((r) => ({ slug: r.slug, label: r.label_en }))}
        roomsByItemType={roomsByItemType}
      />

      {/* F3: Rooms — tri-lingual editable (via chip ✎). */}
      <Block
        kind="rooms"
        title="Rooms"
        hint="A product may belong to multiple rooms · click ✎ to edit labels"
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

      {/* F2: Subtypes — shape/style only, no room field (Migration 0013). */}
      <SubtypesBlock
        itemTypes={tx.itemTypes.map((r) => ({ slug: r.slug, label: r.label_en }))}
        subtypes={tx.itemSubtypes.map((s) => ({
          slug: s.slug,
          item_type_slug: s.item_type_slug,
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

// ─── Item types (F1) ───────────────────────────────────────────────
//
// The item_type row itself is the usual tri-lingual chip (editable
// via the ✎ inside DeleteChip). Under each chip, we render an
// inline checkbox form for the item_type_rooms M2M — one form per
// item_type, each with its own Save button. Delete-all-then-insert
// on the server (see setItemTypeRooms) means unchecked rooms drop
// cleanly without diffing.
//
// We also keep an "add item type" form at the bottom — just the
// generic addTaxonomyItem with kind="item_types".

function ItemTypesBlock({
  itemTypes,
  rooms,
  roomsByItemType,
}: {
  itemTypes: {
    slug: string;
    label: string;
    label_zh: string | null;
    label_ms: string | null;
  }[];
  rooms: { slug: string; label: string }[];
  roomsByItemType: Map<string, Set<string>>;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Item types
        </h2>
        <span className="text-xs text-neutral-400">
          Single-select on a product · rooms below are recommendation hints
        </span>
      </div>

      {itemTypes.length === 0 ? (
        <div className="mb-4 text-xs text-neutral-400">
          (none yet — add one below)
        </div>
      ) : (
        <div className="mb-4 flex flex-col gap-3">
          {itemTypes.map((it) => {
            const selected = roomsByItemType.get(it.slug) ?? new Set<string>();
            return (
              <div
                key={it.slug}
                className="flex flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3"
              >
                <div className="flex flex-wrap items-start gap-2">
                  <DeleteChip
                    kind="item_types"
                    slug={it.slug}
                    label={it.label}
                    labelZh={it.label_zh}
                    labelMs={it.label_ms}
                  />
                </div>
                <form
                  action={setItemTypeRooms}
                  className="flex flex-col gap-2"
                >
                  <input
                    type="hidden"
                    name="item_type_slug"
                    value={it.slug}
                  />
                  <div className="text-[11px] text-neutral-500">
                    Recommended rooms (M2M) — shown with ★ in the
                    Product edit page&rsquo;s Rooms picker. Any room is
                    still selectable for a product; this is a hint, not
                    a constraint.
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {rooms.length === 0 ? (
                      <span className="text-xs text-neutral-400">
                        (no rooms defined yet)
                      </span>
                    ) : (
                      rooms.map((r) => {
                        const isChecked = selected.has(r.slug);
                        return (
                          <label
                            key={r.slug}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                              isChecked
                                ? "border-sky-400 bg-sky-50 text-sky-800"
                                : "border-neutral-300 bg-white text-neutral-700 hover:border-neutral-500"
                            }`}
                          >
                            <input
                              type="checkbox"
                              name="room_slugs"
                              value={r.slug}
                              defaultChecked={isChecked}
                              className="h-3 w-3"
                            />
                            <span>{r.label}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      className="rounded-md bg-black px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800"
                    >
                      Save rooms for {it.label}
                    </button>
                  </div>
                </form>
              </div>
            );
          })}
        </div>
      )}

      <form
        action={addTaxonomyItem}
        className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto]"
      >
        <input type="hidden" name="kind" value="item_types" />
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
          <span className="text-xs text-neutral-600">
            slug (optional, auto-generated)
          </span>
          <input
            name="slug"
            placeholder="a-z 0-9 _"
            pattern="[a-z0-9_]+"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </label>
        <button
          type="submit"
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
        >
          Add item type
        </button>
      </form>
    </section>
  );
}

// ─── Subtypes (F2) ─────────────────────────────────────────────────
//
// Migration 0013: subtypes describe shape / style only. The old
// room_slug column is gone — there's no room dropdown in the
// add-form, and no "→ kitchen" badge on the chip. Subtypes still
// group by item_type so the operator can spot gaps ("does faucet
// have pull-out / sensor yet?").

type SubtypeRow = {
  slug: string;
  item_type_slug: string;
  label_en: string;
  label_zh: string | null;
  label_ms: string | null;
};

function SubtypesBlock({
  itemTypes,
  subtypes,
}: {
  itemTypes: { slug: string; label: string }[];
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
          Shape / style variants of an item type (e.g. Faucet → Pull-out / Sensor)
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
              <div key={it.slug} className="border-l-4 border-neutral-300 pl-4">
                <div className="mb-2 flex items-baseline gap-2">
                  <span className="text-base font-semibold text-neutral-900">
                    {it.label}
                  </span>
                  <span className="text-xs text-neutral-400">
                    ({it.slug}) · {subs.length} subtype(s)
                  </span>
                </div>
                <div className="mb-2 flex flex-wrap gap-2">
                  {subs.length === 0 && (
                    <span className="text-xs text-neutral-400">
                      (none — this item type has no shape/style variants)
                    </span>
                  )}
                  {subs.map((s) => (
                    <SubtypeChip
                      key={`${s.item_type_slug}::${s.slug}`}
                      itemTypeSlug={s.item_type_slug}
                      slug={s.slug}
                      label={s.label_en}
                      labelZh={s.label_zh}
                      labelMs={s.label_ms}
                    />
                  ))}
                </div>
                <form
                  action={addSubtype}
                  className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto]"
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
                      placeholder="e.g. Pull-out"
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
                  <button
                    type="submit"
                    className="rounded-md bg-black px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
                  >
                    Add subtype
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
                    const anyMissing =
                      r.label_zh == null || r.label_ms == null;
                    return (
                      <div
                        key={r.slug}
                        className={`inline-flex flex-col rounded-md border px-3 py-2 ${
                          anyMissing
                            ? "border-amber-300 bg-amber-50"
                            : "border-neutral-300 bg-white"
                        }`}
                      >
                        <TriLingualLabel
                          en={r.label_en}
                          zh={r.label_zh}
                          ms={r.label_ms}
                        />
                        <div className="mt-1 text-[10px] text-neutral-400">
                          {r.slug}
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
  kind: "rooms" | "styles" | "materials" | "colors";
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
            placeholder="e.g. Balcony"
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
