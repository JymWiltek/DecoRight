import { loadTaxonomy } from "@/lib/taxonomy";
import { addTaxonomyItem, deleteTaxonomyItem } from "./actions";

export const dynamic = "force-dynamic";

type SearchParams = {
  added?: string;
  deleted?: string;
  err?: string;
  kind?: string;
  msg?: string;
};

type PageProps = { searchParams: Promise<SearchParams> };

export default async function TaxonomyPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const tx = await loadTaxonomy();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-semibold">分类管理</h1>
        <p className="mt-1 text-sm text-neutral-600">
          物件、房间、风格、材质、颜色都在这里加。加完以后，编辑商品页会立刻出现新按钮。
        </p>
      </header>

      {(sp.added || sp.deleted) && (
        <div className="rounded-md bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
          {sp.added ? `已添加 (${sp.added})` : `已删除 (${sp.deleted})`}
        </div>
      )}
      {sp.err && (
        <div className="rounded-md bg-rose-50 px-4 py-2 text-sm text-rose-700">
          出错了：{errorMessage(sp.err, sp.kind, sp.msg)}
        </div>
      )}

      <Block
        kind="item_types"
        title="物件类型"
        hint="一个产品就是一种东西 · 单选"
        rows={tx.itemTypes.map((r) => ({ slug: r.slug, label: r.label_zh }))}
      />
      <Block
        kind="rooms"
        title="房间 / 使用场景"
        hint="一个产品可属于多个房间"
        rows={tx.rooms.map((r) => ({ slug: r.slug, label: r.label_zh }))}
      />
      <Block
        kind="styles"
        title="风格"
        hint="一个产品可有多种风格"
        rows={tx.styles.map((r) => ({ slug: r.slug, label: r.label_zh }))}
      />
      <Block
        kind="materials"
        title="材质"
        hint="可多选"
        rows={tx.materials.map((r) => ({ slug: r.slug, label: r.label_zh }))}
      />
      <Block
        kind="colors"
        title="颜色"
        hint="可多选 · 带 hex 色值"
        rows={tx.colors.map((r) => ({
          slug: r.slug,
          label: r.label_zh,
          hex: r.hex,
        }))}
      />
    </div>
  );
}

function errorMessage(err: string, kind?: string, msg?: string): string {
  switch (err) {
    case "label":
      return "缺少中文名";
    case "slug":
      return "slug 格式错（只能 a-z 0-9 _）";
    case "hex":
      return "hex 色值格式错（需 #RRGGBB，例 #FF8800）";
    case "db":
      return `数据库 (${kind}): ${msg ?? ""}`;
    default:
      return err;
  }
}

type Row = { slug: string; label: string; hex?: string };

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
          <span className="text-xs text-neutral-400">（空）</span>
        )}
        {rows.map((r) => (
          <form
            key={r.slug}
            action={deleteTaxonomyItem}
            className="group inline-flex items-center gap-1 rounded-full border border-neutral-300 px-3 py-1 text-xs"
          >
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="slug" value={r.slug} />
            {r.hex && (
              <span
                className="h-3 w-3 rounded-full border border-neutral-300"
                style={{ backgroundColor: r.hex }}
              />
            )}
            <span>{r.label}</span>
            <span className="text-neutral-400">· {r.slug}</span>
            <button
              type="submit"
              className="ml-1 text-neutral-400 hover:text-rose-600"
              title="删除"
              aria-label={`删除 ${r.label}`}
            >
              ×
            </button>
          </form>
        ))}
      </div>

      <form
        action={addTaxonomyItem}
        className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1fr_auto] lg:grid-cols-[1fr_1fr_120px_auto]"
      >
        <input type="hidden" name="kind" value={kind} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-600">中文名 *</span>
          <input
            name="label_zh"
            required
            placeholder="例如：Gamer PC"
            className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-600">slug（可选，不填自动生成）</span>
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
          添加
        </button>
      </form>
    </section>
  );
}
