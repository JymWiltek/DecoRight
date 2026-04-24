import Link from "next/link";
import { PRICE_TIERS, PRODUCT_STATUSES } from "@/lib/constants/enums";
import {
  PRICE_TIER_LABELS,
  PRODUCT_STATUS_LABELS,
} from "@/lib/constants/enum-labels";
import type { ProductRow } from "@/lib/supabase/types";
import type { Taxonomy } from "@/lib/taxonomy";
import PillGrid from "./PillGrid";
import SubtypePicker from "./SubtypePicker";
import RoomsPicker from "./RoomsPicker";
import RegionsPicker from "./RegionsPicker";
import FileDropzone from "./FileDropzone";
import AIInferButton from "./AIInferButton";
import DeleteButton from "./DeleteButton";
import SavedToast from "./SavedToast";

type Props = {
  product?: ProductRow | null;
  taxonomy: Taxonomy;
  action: (fd: FormData) => void | Promise<void>;
  saved?: boolean;
  /**
   * When true, render the post-create toast (the one with "+ Another"
   * and "View" actions). Triggered by ?fresh=1 in the URL — only true
   * on first load right after createProduct redirects here.
   */
  freshlyCreated?: boolean;
  /** ?err=upload|db code from a redirect after a failed save. */
  errCode?: string;
  /** ?msg=… message accompanying errCode. */
  errMsg?: string;
  imagesSection?: React.ReactNode;
};

const FORM_ID = "product-form";

export default function ProductForm({
  product,
  taxonomy,
  action,
  saved,
  freshlyCreated,
  errCode,
  errMsg,
  imagesSection,
}: Props) {
  const p = product;
  const isEdit = Boolean(p);
  // Item Type pills are alpha-sorted by label_en per F4 — the
  // existing sort_order was an artificial curation that made the
  // form hard to scan once we passed 30+ types.
  const itemTypeOptions = [...taxonomy.itemTypes]
    .sort((a, b) => a.label_en.localeCompare(b.label_en))
    .map((r) => ({ slug: r.slug, label: r.label_en }));

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      {/* The actual <form> sits empty here. Every field and submit
          button below associates with it via the HTML5 `form` attr
          so the image section can render between Basics and Item
          type as a DOM sibling without violating nested-form rules.
          AIInferButton finds this via data-product-form and builds
          a FormData from form.elements — form.elements DOES include
          elements that reference this form via form="..." attrs. */}
      {/* Post direct-upload refactor: the form no longer carries file
          bytes — GLB is uploaded straight to Storage by FileDropzone,
          which drops a small `glb_path` hidden input here. So we can
          drop encType="multipart/form-data" and ship tiny POSTs that
          don't trip Vercel's 4.5 MB platform body cap. */}
      <form id={FORM_ID} action={action} data-product-form />

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {isEdit ? "Edit product" : "New product"}
          </h1>
          {isEdit && (
            <div className="mt-1 text-xs text-neutral-500">ID: {p!.id}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
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
          {/* F6: three submit buttons, distinguished by `intent`.
              Each <button name="intent" value="…"> posts the form;
              the browser includes the CLICKED button's name+value
              in FormData. parsePayload reads `intent` and overrides
              status accordingly. Plain "Save" posts with intent=save
              so it respects whatever status the PillGrid shows. */}
          <SubmitButtons isEdit={isEdit} />
        </div>
      </header>

      {errCode && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-semibold">
            {errCode === "upload"
              ? "Upload failed"
              : errCode === "db"
                ? "Database rejected the save"
                : errCode === "publish_needs_rooms"
                  ? "Can't publish without rooms"
                  : `Error (${errCode})`}
          </div>
          {errMsg && <div className="mt-1 text-xs">{errMsg}</div>}
        </div>
      )}

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
            {/* PillGrid (button-driven hidden input) instead of native
                radios. Form-attribute-associated radios with
                defaultChecked don't reliably persist their post-click
                state through React 19's restoreStateOfTarget pass —
                clicking "Published" submitted as "draft" because the
                radio-group restore loop re-applies stale defaultChecked
                to every other radio in the document. PillGrid drives
                the value purely from React state, so what you see is
                what gets submitted. Same fix is applied to price_tier
                below. */}
            <PillGrid
              form={FORM_ID}
              name="status"
              options={PRODUCT_STATUSES.map((s) => ({
                slug: s,
                label: PRODUCT_STATUS_LABELS[s],
              }))}
              initial={p?.status ?? "draft"}
            />
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
        title="3D model"
        hint="Optional. .glb file (60 MB max). Sits right below the image uploads for quick batch upload."
      >
        <Field label=".glb model">
          <FileDropzone
            form={FORM_ID}
            // Name is the STORAGE PATH field the server action reads —
            // post-refactor the client PUTs bytes direct to Storage
            // and only the resulting path string flows through FormData.
            name="glb_path"
            accept=".glb,model/gltf-binary"
            maxFileMb={60}
            productId={p?.id ?? null}
            currentUrl={p?.glb_url ?? null}
            currentMeta={p?.glb_size_kb != null ? `${p.glb_size_kb} KB` : null}
            hint="Drop .glb here, or click to pick"
          />
        </Field>
      </Section>

      <Section
        title="Item type *"
        hint="Pick one — what kind of thing this is. Alpha-sorted."
      >
        <PillGrid
          form={FORM_ID}
          name="item_type"
          options={itemTypeOptions}
          initial={p?.item_type ?? null}
        />
      </Section>

      <Section
        title="Subtype"
        hint="Optional shape/style variant of the picked item type (e.g. Faucet → Pull-out / Sensor)."
      >
        <SubtypePicker
          form={FORM_ID}
          subtypes={taxonomy.itemSubtypes}
          initial={p?.subtype_slug ?? null}
          initialItemType={p?.item_type ?? null}
        />
      </Section>

      <Section
        title="Rooms *"
        hint="Which room(s) this product belongs in. Multi-select — a faucet can live in Kitchen AND Bathroom."
      >
        <RoomsPicker
          form={FORM_ID}
          rooms={taxonomy.rooms}
          itemTypeRooms={taxonomy.itemTypeRooms}
          initial={p?.room_slugs ?? []}
          initialItemType={p?.item_type ?? null}
        />
      </Section>

      <Section
        title="Store locations · 供应商门店所在地"
        hint="Which Wiltek showrooms physically stock this. Display-only — does NOT restrict who can buy it."
      >
        <RegionsPicker
          form={FORM_ID}
          regions={taxonomy.regions}
          initial={p?.store_locations ?? []}
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
            {/* See note on Status above — same radio quirk reason.
                Click the selected pill again to clear back to no tier. */}
            <PillGrid
              form={FORM_ID}
              name="price_tier"
              options={PRICE_TIERS.map((t) => ({
                slug: t,
                label: PRICE_TIER_LABELS[t],
              }))}
              initial={p?.price_tier ?? null}
            />
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
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-black"
          >
            Cancel
          </Link>
          <SubmitButtons isEdit={isEdit} />
        </div>
      </footer>

      {isEdit && (
        <SavedToast show={Boolean(freshlyCreated)} productId={p!.id} />
      )}
    </div>
  );
}

/**
 * F6 submit triad: one row of three buttons in both header and
 * footer, each distinguished by the `intent` FormData key
 * (browsers include the CLICKED button's name+value on submit).
 *
 *   - Save            → intent=save      → respect the Status pill
 *   - Save as Draft   → intent=draft     → force status=draft
 *   - Publish         → intent=publish   → force status=published
 *
 * parsePayload in products/actions.ts reads `intent` and overrides
 * the status accordingly. If the operator picks Publish but the
 * product has no rooms, the action redirects back with a friendly
 * error instead of letting the DB trigger throw a raw Postgres
 * message. Publish is emerald, Draft is amber, Save is neutral —
 * so the destructive "goes live" action stands out.
 *
 * On /products/new (isEdit=false) we collapse to just "Create
 * product" because a new row is always created as draft (no images
 * yet, no rooms to confirm publish-readiness against).
 */
function SubmitButtons({ isEdit }: { isEdit: boolean }) {
  if (!isEdit) {
    return (
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="draft"
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
      >
        Create product
      </button>
    );
  }
  return (
    <>
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="draft"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
        title="Save and mark as draft (hidden from storefront)"
      >
        Save as Draft
      </button>
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="save"
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:border-black"
        title="Save with the status currently selected above"
      >
        Save
      </button>
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="publish"
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
        title="Save and publish — becomes visible on the storefront"
      >
        Publish
      </button>
    </>
  );
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
