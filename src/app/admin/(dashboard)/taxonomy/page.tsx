import { loadTaxonomy } from "@/lib/taxonomy";
import { addTaxonomyItem } from "./actions";
import DeleteChip from "./DeleteChip";

export const dynamic = "force-dynamic";

type SearchParams = {
  added?: string;
  deleted?: string;
  err?: string;
  kind?: string;
  msg?: string;
  slug?: string;
  count?: string;
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
          {errorMessage(sp.err, sp.kind, sp.msg, sp.slug, sp.count)}
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

function errorMessage(
  err: string,
  kind?: string,
  msg?: string,
  slug?: string,
  count?: string,
): string {
  switch (err) {
    case "label":
      return "出错了：缺少中文名";
    case "slug":
      return "出错了：请用包含至少一个英文字母或数字的名字，或手填 slug（例：gamer_pc）";
    case "hex":
      return "出错了：hex 色值格式错（需 #RRGGBB，例 #FF8800）";
    case "inuse":
      return `不能删除：还有 ${count ?? "?"} 件商品在用「${slug ?? ""}」。请先把这些商品改成别的分类，再回来删。`;
    case "db":
      return `数据库出错 (${kind}): ${msg ?? ""}`;
    default:
      return `出错了：${err}`;
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
          <DeleteChip
            key={r.slug}
            kind={kind}
            slug={r.slug}
            label={r.label}
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
