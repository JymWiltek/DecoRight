import { loadTaxonomy } from "@/lib/taxonomy";
import { addTaxonomyItem } from "./actions";
import AutoTranslateButton from "./AutoTranslateButton";
import DeleteChip from "./DeleteChip";

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

/** Count of rows missing at least one of label_en / label_ms, across every
 *  taxonomy kind. Drives the "Auto-translate (N)" button label. */
function countMissing(
  rows: { label_en: string | null; label_ms: string | null }[],
): number {
  let n = 0;
  for (const r of rows) {
    if (r.label_en == null || r.label_ms == null) n += 1;
  }
  return n;
}

export default async function TaxonomyPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tx = await loadTaxonomy();

  const missingCount =
    countMissing(tx.itemTypes) +
    countMissing(tx.rooms) +
    countMissing(tx.styles) +
    countMissing(tx.materials) +
    countMissing(tx.colors);

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
            Chinese is the source of truth. English + Malay labels are
            filled in by Claude Sonnet 4.5 via the button on the right.
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
            ? "Nothing to translate — all labels already have English + Malay."
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
          label: r.label_zh,
          label_en: r.label_en,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="rooms"
        title="Rooms / usage"
        hint="A product may belong to multiple rooms"
        rows={tx.rooms.map((r) => ({
          slug: r.slug,
          label: r.label_zh,
          label_en: r.label_en,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="styles"
        title="Styles"
        hint="A product may have multiple styles"
        rows={tx.styles.map((r) => ({
          slug: r.slug,
          label: r.label_zh,
          label_en: r.label_en,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="materials"
        title="Materials"
        hint="Multi-select"
        rows={tx.materials.map((r) => ({
          slug: r.slug,
          label: r.label_zh,
          label_en: r.label_en,
          label_ms: r.label_ms,
        }))}
      />
      <Block
        kind="colors"
        title="Colors"
        hint="Multi-select · with hex value"
        rows={tx.colors.map((r) => ({
          slug: r.slug,
          label: r.label_zh,
          label_en: r.label_en,
          label_ms: r.label_ms,
          hex: r.hex,
        }))}
      />
    </div>
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
  label_en: string | null;
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
            labelEn={r.label_en}
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
          <span className="text-xs text-neutral-600">Label (zh) *</span>
          <input
            name="label_zh"
            required
            placeholder="e.g. 电脑桌"
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
