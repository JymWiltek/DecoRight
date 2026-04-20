import Link from "next/link";
import {
  CATEGORIES,
  STYLES,
  PRIMARY_COLORS,
  MATERIALS,
  INSTALLATIONS,
  APPLICABLE_SPACES,
  PRICE_TIERS,
  PRODUCT_STATUSES,
} from "@/lib/constants/enums";
import {
  CATEGORY_LABELS,
  STYLE_LABELS,
  PRIMARY_COLOR_LABELS,
  MATERIAL_LABELS,
  INSTALLATION_LABELS,
  APPLICABLE_SPACE_LABELS,
  PRICE_TIER_LABELS,
} from "@/lib/constants/enum-labels";
import type { ProductRow } from "@/lib/supabase/types";
import ColorVariantsEditor from "./ColorVariantsEditor";
import AIInferButton from "./AIInferButton";
import DeleteButton from "./DeleteButton";

type Props = {
  product?: ProductRow | null;
  action: (fd: FormData) => void | Promise<void>;
  saved?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  published: "已上架",
  archived: "归档",
  link_broken: "链接失效",
};

export default function ProductForm({ product, action, saved }: Props) {
  const p = product;
  const isEdit = Boolean(p);

  return (
    <form
      action={action}
      data-product-form
      encType="multipart/form-data"
      className="mx-auto max-w-5xl space-y-8 px-6 py-8"
    >
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {isEdit ? "编辑商品" : "新增商品"}
          </h1>
          {isEdit && (
            <div className="mt-1 text-xs text-neutral-500">ID: {p!.id}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
              已保存
            </span>
          )}
          <Link
            href="/admin"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:border-black"
          >
            返回
          </Link>
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {isEdit ? "保存修改" : "创建商品"}
          </button>
        </div>
      </header>

      <Section title="AI 辅助">
        <AIInferButton />
      </Section>

      <Section title="基础">
        <Grid>
          <Field label="名称 *">
            <input
              name="name"
              required
              defaultValue={p?.name ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="品牌">
            <input name="brand" defaultValue={p?.brand ?? ""} className={inputCls} />
          </Field>
          <Field label="分类 *">
            <select
              name="category"
              required
              defaultValue={p?.category ?? ""}
              className={inputCls}
            >
              <option value="" disabled>
                请选择
              </option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="子分类">
            <input
              name="subcategory"
              defaultValue={p?.subcategory ?? ""}
              placeholder="e.g. faucet / dining_chair"
              className={inputCls}
            />
          </Field>
          <Field label="状态" wide>
            <select
              name="status"
              defaultValue={p?.status ?? "draft"}
              className={inputCls}
            >
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="描述" wide>
            <textarea
              name="description"
              rows={4}
              defaultValue={p?.description ?? ""}
              className={inputCls}
            />
          </Field>
        </Grid>
      </Section>

      <Section title="属性">
        <Grid>
          <Field label="风格">
            <select
              name="style"
              defaultValue={p?.style ?? ""}
              className={inputCls}
            >
              <option value="">—</option>
              {STYLES.map((s) => (
                <option key={s} value={s}>
                  {STYLE_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="主色">
            <select
              name="primary_color"
              defaultValue={p?.primary_color ?? ""}
              className={inputCls}
            >
              <option value="">—</option>
              {PRIMARY_COLORS.map((c) => (
                <option key={c} value={c}>
                  {PRIMARY_COLOR_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="材质">
            <select
              name="material"
              defaultValue={p?.material ?? ""}
              className={inputCls}
            >
              <option value="">—</option>
              {MATERIALS.map((m) => (
                <option key={m} value={m}>
                  {MATERIAL_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="安装方式">
            <select
              name="installation"
              defaultValue={p?.installation ?? ""}
              className={inputCls}
            >
              <option value="">—</option>
              {INSTALLATIONS.map((i) => (
                <option key={i} value={i}>
                  {INSTALLATION_LABELS[i]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="适用空间（多选）" wide>
            <div className="flex flex-wrap gap-2">
              {APPLICABLE_SPACES.map((s) => {
                const checked = p?.applicable_space?.includes(s) ?? false;
                return (
                  <label
                    key={s}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-300 px-3 py-1 text-xs"
                  >
                    <input
                      type="checkbox"
                      name="applicable_space"
                      value={s}
                      defaultChecked={checked}
                      className="h-3 w-3"
                    />
                    {APPLICABLE_SPACE_LABELS[s]}
                  </label>
                );
              })}
            </div>
          </Field>
        </Grid>
      </Section>

      <Section title="价格与尺寸">
        <Grid>
          <Field label="售价 (MYR)">
            <input
              type="number"
              step="0.01"
              name="price_myr"
              defaultValue={p?.price_myr ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="价格档次">
            <select
              name="price_tier"
              defaultValue={p?.price_tier ?? ""}
              className={inputCls}
            >
              <option value="">—</option>
              {PRICE_TIERS.map((t) => (
                <option key={t} value={t}>
                  {PRICE_TIER_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="尺寸 · 长 (mm)">
            <input
              type="number"
              name="dim_length"
              defaultValue={p?.dimensions_mm?.length ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="尺寸 · 宽 (mm)">
            <input
              type="number"
              name="dim_width"
              defaultValue={p?.dimensions_mm?.width ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="尺寸 · 高 (mm)">
            <input
              type="number"
              name="dim_height"
              defaultValue={p?.dimensions_mm?.height ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="重量 (kg)">
            <input
              type="number"
              step="0.01"
              name="weight_kg"
              defaultValue={p?.weight_kg ?? ""}
              className={inputCls}
            />
          </Field>
        </Grid>
      </Section>

      <Section title="色变（Phase-1 简化版：颜色切换时前端 override 基色）">
        <ColorVariantsEditor
          name="color_variants_json"
          initial={p?.color_variants ?? []}
        />
      </Section>

      <Section title="3D 模型与缩略图">
        <Grid>
          <Field label="上传 .glb (替换)">
            <input
              type="file"
              name="glb_file"
              accept=".glb,model/gltf-binary"
              className="text-sm"
            />
            {p?.glb_url && (
              <div className="mt-2 text-xs text-neutral-500">
                当前：<a href={p.glb_url} target="_blank" rel="noopener" className="text-sky-600 hover:underline">{p.glb_url.split("/").slice(-2).join("/")}</a>
                {p.glb_size_kb != null && <> · {p.glb_size_kb} KB</>}
              </div>
            )}
          </Field>
          <Field label="上传缩略图 (webp/png/jpg，替换)">
            <input
              type="file"
              name="thumbnail_file"
              accept="image/webp,image/png,image/jpeg"
              className="text-sm"
            />
            {p?.thumbnail_url && (
              <div className="mt-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.thumbnail_url}
                  alt=""
                  className="h-24 w-24 rounded border border-neutral-200 object-cover"
                />
              </div>
            )}
          </Field>
        </Grid>
      </Section>

      <Section title="购买链接与来源">
        <Grid>
          <Field label="购买外链" wide>
            <input
              type="url"
              name="purchase_url"
              defaultValue={p?.purchase_url ?? ""}
              placeholder="https://wiltek.com.my/products/..."
              className={inputCls}
            />
          </Field>
          <Field label="供应商">
            <input
              name="supplier"
              defaultValue={p?.supplier ?? ""}
              className={inputCls}
            />
          </Field>
        </Grid>
      </Section>

      {isEdit && p?.ai_filled_fields && p.ai_filled_fields.length > 0 && (
        <Section title="AI 填充记录">
          <div className="flex flex-wrap gap-2">
            {p.ai_filled_fields.map((f) => (
              <span
                key={f}
                className="rounded-full bg-sky-50 px-3 py-1 text-xs text-sky-700"
              >
                {f}
              </span>
            ))}
          </div>
          <div className="mt-2 text-xs text-neutral-500">
            这些字段由 AI 推断，已被人类 review。
          </div>
        </Section>
      )}

      {p?.ai_filled_fields?.map((f) => (
        <input key={f} type="hidden" name="ai_filled_fields" value={f} />
      ))}

      <footer className="flex items-center justify-between border-t border-neutral-200 pt-6">
        <div>{isEdit && <DeleteButton id={p!.id} name={p!.name} />}</div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-black"
          >
            取消
          </Link>
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {isEdit ? "保存修改" : "创建商品"}
          </button>
        </div>
      </footer>
    </form>
  );
}

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{children}</div>;
}

function Field({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${wide ? "md:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      {children}
    </label>
  );
}
