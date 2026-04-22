import Link from "next/link";
import { PRICE_TIERS, PRODUCT_STATUSES } from "@/lib/constants/enums";
import {
  PRICE_TIER_LABELS,
  PRODUCT_STATUS_LABELS,
} from "@/lib/constants/enum-labels";
import type { ProductRow } from "@/lib/supabase/types";
import type { Taxonomy } from "@/lib/taxonomy";
import PillGrid from "./PillGrid";
import AIInferButton from "./AIInferButton";
import DeleteButton from "./DeleteButton";

type Props = {
  product?: ProductRow | null;
  taxonomy: Taxonomy;
  action: (fd: FormData) => void | Promise<void>;
  saved?: boolean;
  /**
   * Inline image management, rendered between Basics and Item type.
   * Only meaningful on the edit workbench (we need a product id to
   * hang images off). The new-product page passes `undefined`.
   *
   * Rendered as a sibling of the main product <form> — NOT inside
   * it — because the image section contains its own server-action
   * <form> elements (upload, approve, reject, …) and HTML forbids
   * nested forms. All product-data fields use `form={FORM_ID}` to
   * associate with the top-level update form regardless of where
   * they live in the DOM tree.
   */
  imagesSection?: React.ReactNode;
};

const FORM_ID = "product-form";

export default function ProductForm({
  product,
  taxonomy,
  action,
  saved,
  imagesSection,
}: Props) {
  const p = product;
  const isEdit = Boolean(p);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      {/* The actual <form> sits empty here. Every field and submit
          button below associates with it via the HTML5 `form` attr
          so the image section can render between Basics and Item
          type as a DOM sibling without violating nested-form rules.
          AIInferButton finds this via data-product-form and builds
          a FormData from form.elements — form.elements DOES include
          elements that reference this form via form="..." attrs. */}
      <form
        id={FORM_ID}
        action={action}
        encType="multipart/form-data"
        data-product-form
      />

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {isEdit ? "Edit product" : "New product"}
          </h1>
          {isEdit && (
            <div className="mt-1 text-xs text-neutral-500">ID: {p!.id}</div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs text-emerald-700">
              Saved
            </span>
          )}
          <Link
            href="/admin"
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:border-black"
          >
            Back
          </Link>
          <button
            type="submit"
            form={FORM_ID}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {isEdit ? "Save changes" : "Create product"}
          </button>
        </div>
      </header>

      <Section title="AI assist">
        <AIInferButton />
      </Section>

      <Section title="Basics">
        <Grid>
          <Field label="Name *">
            <input
              form={FORM_ID}
              name="name"
              required
              defaultValue={p?.name ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Brand">
            <input
              form={FORM_ID}
              name="brand"
              defaultValue={p?.brand ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Status" wide>
            <div className="flex flex-wrap gap-2">
              {PRODUCT_STATUSES.map((s) => (
                <label
                  key={s}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-xs has-[:checked]:border-black has-[:checked]:bg-black has-[:checked]:text-white"
                >
                  <input
                    form={FORM_ID}
                    type="radio"
                    name="status"
                    value={s}
                    defaultChecked={(p?.status ?? "draft") === s}
                    className="sr-only"
                  />
                  {PRODUCT_STATUS_LABELS[s]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Description" wide>
            <textarea
              form={FORM_ID}
              name="description"
              rows={4}
              defaultValue={p?.description ?? ""}
              className={inputCls}
            />
          </Field>
        </Grid>
      </Section>

      {imagesSection}

      <Section
        title="Item type *"
        hint="Pick one — a product is one kind of thing. Room is derived from the item type (set under Taxonomy)."
      >
        <PillGrid
          form={FORM_ID}
          name="item_type"
          options={taxonomy.itemTypes.map((r) => ({
            slug: r.slug,
            label: r.label_en,
          }))}
          initial={p?.item_type ?? null}
        />
      </Section>

      <Section title="Styles (multi)">
        <PillGrid
          form={FORM_ID}
          name="styles"
          multi
          options={taxonomy.styles.map((r) => ({
            slug: r.slug,
            label: r.label_en,
          }))}
          initial={p?.styles ?? []}
        />
      </Section>

      <Section title="Colors (multi)">
        <PillGrid
          form={FORM_ID}
          name="colors"
          multi
          variant="color"
          options={taxonomy.colors.map((c) => ({
            slug: c.slug,
            label: c.label_en,
            hex: c.hex,
          }))}
          initial={p?.colors ?? []}
        />
      </Section>

      <Section title="Materials (multi)">
        <PillGrid
          form={FORM_ID}
          name="materials"
          multi
          options={taxonomy.materials.map((r) => ({
            slug: r.slug,
            label: r.label_en,
          }))}
          initial={p?.materials ?? []}
        />
      </Section>

      <Section title="Price & dimensions">
        <Grid>
          <Field label="Price (MYR)">
            <input
              form={FORM_ID}
              type="number"
              step="0.01"
              name="price_myr"
              defaultValue={p?.price_myr ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Price tier">
            <div className="flex flex-wrap gap-2">
              <RadioPill name="price_tier" value="" label="—" checked={!p?.price_tier} />
              {PRICE_TIERS.map((t) => (
                <RadioPill
                  key={t}
                  name="price_tier"
                  value={t}
                  label={PRICE_TIER_LABELS[t]}
                  checked={p?.price_tier === t}
                />
              ))}
            </div>
          </Field>
          <Field label="Length (mm)">
            <input
              form={FORM_ID}
              type="number"
              name="dim_length"
              defaultValue={p?.dimensions_mm?.length ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Width (mm)">
            <input
              form={FORM_ID}
              type="number"
              name="dim_width"
              defaultValue={p?.dimensions_mm?.width ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Height (mm)">
            <input
              form={FORM_ID}
              type="number"
              name="dim_height"
              defaultValue={p?.dimensions_mm?.height ?? ""}
              className={inputCls}
            />
          </Field>
          <Field label="Weight (kg)">
            <input
              form={FORM_ID}
              type="number"
              step="0.01"
              name="weight_kg"
              defaultValue={p?.weight_kg ?? ""}
              className={inputCls}
            />
          </Field>
        </Grid>
      </Section>

      <Section title="3D model & thumbnail">
        <Grid>
          <Field label="Upload .glb (replace)">
            <input
              form={FORM_ID}
              type="file"
              name="glb_file"
              accept=".glb,model/gltf-binary"
              className="text-sm"
            />
            {p?.glb_url && (
              <div className="mt-2 text-xs text-neutral-500">
                Current:
                <a
                  href={p.glb_url}
                  target="_blank"
                  rel="noopener"
                  className="text-sky-600 hover:underline"
                >
                  {p.glb_url.split("/").slice(-2).join("/")}
                </a>
                {p.glb_size_kb != null && <> · {p.glb_size_kb} KB</>}
              </div>
            )}
          </Field>
          <Field label="Upload thumbnail (webp/png/jpg, replace)">
            <input
              form={FORM_ID}
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
            <p className="mt-1 text-[11px] text-neutral-500">
              Optional. If you upload an image above and approve it as primary,
              the thumbnail is set automatically.
            </p>
          </Field>
        </Grid>
      </Section>

      <Section title="Purchase link & source">
        <Grid>
          <Field label="External purchase URL" wide>
            <input
              form={FORM_ID}
              type="url"
              name="purchase_url"
              defaultValue={p?.purchase_url ?? ""}
              placeholder="https://wiltek.com.my/products/..."
              className={inputCls}
            />
          </Field>
          <Field label="Supplier">
            <input
              form={FORM_ID}
              name="supplier"
              defaultValue={p?.supplier ?? ""}
              className={inputCls}
            />
          </Field>
        </Grid>
      </Section>

      {isEdit && p?.ai_filled_fields && p.ai_filled_fields.length > 0 && (
        <Section title="AI-filled fields">
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
            These fields were inferred by AI and have been human-reviewed.
          </div>
        </Section>
      )}

      {p?.ai_filled_fields?.map((f) => (
        <input
          key={f}
          form={FORM_ID}
          type="hidden"
          name="ai_filled_fields"
          value={f}
        />
      ))}

      <footer className="flex items-center justify-between border-t border-neutral-200 pt-6">
        <div>{isEdit && <DeleteButton id={p!.id} name={p!.name} />}</div>
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-black"
          >
            Cancel
          </Link>
          <button
            type="submit"
            form={FORM_ID}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            {isEdit ? "Save changes" : "Create product"}
          </button>
        </div>
      </footer>
    </div>
  );

  function RadioPill({
    name,
    value,
    label,
    checked,
  }: {
    name: string;
    value: string;
    label: string;
    checked: boolean;
  }) {
    return (
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-neutral-300 px-3 py-1 text-xs has-[:checked]:border-black has-[:checked]:bg-black has-[:checked]:text-white">
        <input
          form={FORM_ID}
          type="radio"
          name={name}
          value={value}
          defaultChecked={checked}
          className="sr-only"
        />
        {label}
      </label>
    );
  }
}

const inputCls =
  "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-5">
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h2>
        {hint && <span className="text-xs text-neutral-400">{hint}</span>}
      </div>
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
