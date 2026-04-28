"use client";

/**
 * Product edit workbench — client shell that owns the submit
 * lifecycle end to end.
 *
 * Why a client component and not the previous server component?
 * The earlier direct-upload version had each dropzone kick
 * uploads + rembg on its own button click, which violated the
 * "nothing commits until Save" principle Jym pinned:
 *
 *   - Dragging a file ≠ committing resources.
 *   - Clicking Save / Publish = one atomic commit — files go to
 *     Storage *then* the product row writes *then* (iff the
 *     product ends up published) rembg runs.
 *   - Save as Draft NEVER spends rembg money. Only Publish (or
 *     Save on an already-published product) does.
 *
 * To get that atomicity the form has to coordinate uploads across
 * the two dropzones before the server action fires. Server
 * components can't do client-side IO + imperative handles, so the
 * outer shell lives here as a client component. Every field is
 * still a plain <input>/<textarea> submitting via `form={FORM_ID}`
 * — the only change is that `<form>` itself has an `onSubmit`
 * handler (not `action=`) and we invoke the server action
 * manually after pending uploads finish.
 */

import Link from "next/link";
import { useRef, useState } from "react";
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
import { AutofillTextInput, AutofillTextarea } from "./AutofillTextInput";
import DeleteButton from "./DeleteButton";
import SavedToast from "./SavedToast";
import {
  StagedUploadsProvider,
  SubmitPhaseBanner,
  type StagedUploader,
  type SubmitPhase,
} from "./product-form-staging";

type Props = {
  product?: ProductRow | null;
  taxonomy: Taxonomy;
  /** Server action. Bound with the product id on /edit; bare on /new.
   *  We no longer pass this as `<form action={…}>` — the client shell
   *  invokes it directly after pending-file uploads finish. */
  action: (fd: FormData) => void | Promise<void>;
  saved?: boolean;
  /** When true, render the post-create toast (the one with "+ Another"
   *  and "View" actions). Triggered by ?fresh=1 in the URL — only true
   *  on first load right after createProduct redirects here. */
  freshlyCreated?: boolean;
  /** ?err=upload|db code from a redirect after a failed save. */
  errCode?: string;
  /** ?msg=… message accompanying errCode. */
  errMsg?: string;
  imagesSection?: React.ReactNode;
  /** Optional Meshy generation status banner (Edit page only). When
   *  provided, renders at the very top of the form so the operator
   *  sees Meshy progress before scrolling. /new doesn't pass this. */
  meshyBanner?: React.ReactNode;
};

const FORM_ID = "product-form";

type Intent = "save" | "draft" | "publish";

export default function ProductForm({
  product,
  taxonomy,
  action,
  saved,
  freshlyCreated,
  errCode,
  errMsg,
  imagesSection,
  meshyBanner,
}: Props) {
  const p = product;
  const isEdit = Boolean(p);
  // Item Type pills are alpha-sorted by label_en per F4 — the
  // existing sort_order was an artificial curation that made the
  // form hard to scan once we passed 30+ types.
  const itemTypeOptions = [...taxonomy.itemTypes]
    .sort((a, b) => a.label_en.localeCompare(b.label_en))
    .map((r) => ({
      slug: r.slug,
      label: r.label_en,
      label_zh: r.label_zh,
      label_ms: r.label_ms,
    }));

  const formRef = useRef<HTMLFormElement>(null);
  const registryRef = useRef<Map<string, StagedUploader>>(new Map());
  const [phase, setPhase] = useState<SubmitPhase>({ kind: "idle" });
  const busy = phase.kind === "uploading" || phase.kind === "saving";

  /**
   * Central submit lifecycle:
   *   1. Figure out intent from the clicked button's `value` (browsers
   *      include the submitter's name+value on `submit` events).
   *   2. Iterate every registered uploader sequentially:
   *       a. Run its PUT phase.
   *       b. Collect the hidden fields it wants appended to FormData.
   *      Sequentially (not parallel) because Supabase Storage rate-
   *      limits per-project and a batch of 1–10 files doesn't benefit
   *      enough from parallelism to justify the complexity.
   *   3. Build FormData from the form, append collected fields + intent,
   *      call the server action. It does its own rembg + redirect.
   */
  async function submit(intent: Intent) {
    if (busy) return;
    setPhase({ kind: "uploading", label: "starting", done: 0, total: 0 });

    const uploaders = Array.from(registryRef.current.values());
    const totalFiles = uploaders.reduce(
      (n, u) => n + u.pendingCount(),
      0,
    );
    // Even if there are zero pending files, go through the flow —
    // we still need to call the server action. Skip the "uploading"
    // banner in that case so the user sees "Saving…" immediately.
    if (totalFiles > 0) {
      setPhase({
        kind: "uploading",
        label: uploaders[0]?.label ?? "files",
        done: 0,
        total: totalFiles,
      });
    }

    const stagedFields: { name: string; value: string }[] = [];
    let runningDone = 0;

    try {
      for (const u of uploaders) {
        if (u.pendingCount() === 0) continue;
        const fields = await u.run(({ label, done, total }) => {
          // Report cumulative progress across all uploaders so the
          // banner reads as one continuous 0→N, not a reset per
          // dropzone. Each uploader calls us with its own done/total;
          // we add its done to the previously-completed uploaders.
          setPhase({
            kind: "uploading",
            label,
            done: runningDone + done,
            total: totalFiles,
          });
          // When this uploader finishes (done === total) we roll
          // its contribution into runningDone for the next round.
          if (done === total) runningDone += total;
        });
        stagedFields.push(...fields);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPhase({ kind: "error", message: `Upload failed: ${msg}` });
      return;
    }

    const form = formRef.current;
    if (!form) {
      setPhase({ kind: "error", message: "form element missing" });
      return;
    }

    // FormData snapshot after uploads so any late state changes
    // (unlikely — UI is disabled while busy) still land cleanly.
    const fd = new FormData(form);
    fd.set("intent", intent);
    for (const f of stagedFields) {
      // append (not set) so a dropzone emitting multiple entries
      // under the same key keeps all of them.
      fd.append(f.name, f.value);
    }

    setPhase({ kind: "saving", intent });
    try {
      await action(fd);
      // If we reach here without navigation, the server action
      // completed without redirect — current actions always redirect,
      // so this path shouldn't hit in practice. Reset phase just in
      // case so the UI isn't stuck on "Saving…".
      setPhase({ kind: "idle" });
    } catch (err) {
      // IMPORTANT: server-action redirects are thrown as a special
      // marker object with `digest` starting with "NEXT_REDIRECT"
      // (or "NEXT_NOT_FOUND" for notFound()). Next's client runtime
      // intercepts the throw at the framework boundary to perform
      // the navigation — but only if WE rethrow. Swallowing it here
      // is what made the first test show a red "Save failed:
      // NEXT_REDIRECT" banner while the save actually succeeded.
      //
      // We also reset phase → idle BEFORE rethrowing. Without this,
      // the banner stays stuck on "Saving…" after the redirect lands:
      // React preserves component state across Next's soft-nav remount,
      // so a phase that was "saving" at throw time survives into the
      // destination page. setState is synchronous bookkeeping — it
      // schedules the update, and the scheduled update carries through
      // the remount to show the freshly-landed page in its idle state.
      if (isFrameworkRedirect(err)) {
        setPhase({ kind: "idle" });
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setPhase({ kind: "error", message: `Save failed: ${msg}` });
    }
  }

  /**
   * Detects the internal-nav marker Next.js throws from redirect()
   * / notFound(). We check the `digest` string shape rather than
   * importing from `next/dist/client/components/...` — that path is
   * unstable across Next versions, but the digest contract is the
   * piece the framework relies on publicly.
   */
  function isFrameworkRedirect(err: unknown): boolean {
    if (!err || typeof err !== "object" || !("digest" in err)) return false;
    const d = (err as { digest?: unknown }).digest;
    if (typeof d !== "string") return false;
    return d.startsWith("NEXT_REDIRECT") || d === "NEXT_NOT_FOUND";
  }

  function onFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const raw = submitter?.value ?? "save";
    const intent: Intent =
      raw === "draft" ? "draft" : raw === "publish" ? "publish" : "save";
    void submit(intent);
  }

  return (
    <StagedUploadsProvider busy={busy} registryRef={registryRef}>
      <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
        {/* The actual <form> sits empty here. Every field and submit
            button below associates with it via the HTML5 `form` attr
            so the image section can render between Basics and Item
            type as a DOM sibling without violating nested-form rules.
            AIInferButton finds this via data-product-form and builds
            a FormData from form.elements — form.elements DOES include
            elements that reference this form via form="..." attrs. */}
        {/* Post direct-upload refactor: the form no longer carries file
            bytes — GLB + raw images stage in their dropzones, the
            `onSubmit` handler above PUTs them to Storage direct, then
            appends hidden fields (`glb_path`, `raw_image_entries`) to
            the FormData before calling the server action. No encType
            needed; payload is KB-size strings. */}
        <form
          id={FORM_ID}
          ref={formRef}
          onSubmit={onFormSubmit}
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
          <div className="flex items-center gap-2">
            {saved && phase.kind === "idle" && (
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
                as `submitter` on the submit event. We read that in
                onFormSubmit to pick the right intent. */}
            <SubmitButtons isEdit={isEdit} busy={busy} />
          </div>
        </header>

        {meshyBanner}

        <SubmitPhaseBanner phase={phase} />

        {errCode && phase.kind === "idle" && (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="font-semibold">
              {errCode === "upload"
                ? "Upload failed"
                : errCode === "db"
                  ? "Database rejected the save"
                  : errCode === "publish_blocked"
                    ? "Can't publish yet"
                    : `Error (${errCode})`}
            </div>
            {errMsg && <div className="mt-1 text-xs">{errMsg}</div>}
          </div>
        )}

        {/*
          Section order locked by Phase 1 收尾 F5 (Notion table). Top-
          to-bottom mirrors the operator's natural workflow:
            1. Drop photos & 3D first (visual anchor — this is what AI
               classifies against, what the storefront shows).
            2. Click AI assist next so the auto-picks land before the
               operator manually edits anything.
            3. Basics — name/brand/status/description (manual fields).
            4. Rooms ✱ → Item type ✱ → Subtype. Rooms is intentionally
               above Item type per F5: rooms are a stronger product
               organizer in our catalog (faucets live in Kitchen AND
               Bathroom — picking rooms first keeps that intuitive).
               RoomsPicker handles itemType=null gracefully (no ★
               recommendations until item_type is set; live updates
               via 100ms poll once it is).
            5. Styles / Colors / Materials — all multi-selects.
            6. Price & dimensions, then Purchase link + Store locations
               (logically grouped: where to buy + where it's stocked).
            7. AI-filled display chip row (review trail, isEdit only).
          Don't reorder without updating the matching docs in Notion.
        */}

        {imagesSection}

        <Section
          title="3D model"
          hint="Optional. .glb file (60 MB max). Staged for upload — nothing uploads until you click Save."
        >
          <Field label=".glb model">
            <FileDropzone
              accept=".glb,model/gltf-binary"
              maxFileMb={60}
              productId={p?.id ?? null}
              currentUrl={p?.glb_url ?? null}
              currentMeta={p?.glb_size_kb != null ? `${p.glb_size_kb} KB` : null}
              hint="Drop .glb here, or click to pick"
            />
          </Field>
        </Section>

        <Section title="AI assist">
          <AIInferButton productId={p?.id ?? null} form={FORM_ID} />
        </Section>

        <Section title="Basics">
          <Grid>
            <Field label="Name *">
              {/* Wave 2A · Commit 8: name is now AI-fillable. The
                  AutofillTextInput listens to ai-autofill-apply and
                  overwrites its value when the model returns a string;
                  null / undefined keeps whatever the operator typed. */}
              <AutofillTextInput
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
              {/* Wave 2A · Commit 8: AI-fillable. See AutofillTextInput
                  rationale above; same pattern, multi-line shape. */}
              <AutofillTextarea
                form={FORM_ID}
                name="description"
                rows={4}
                defaultValue={p?.description ?? ""}
                className={inputCls}
              />
            </Field>
          </Grid>
        </Section>

        {/*
          Title-suffix discipline (Phase 1 收尾 P2 #3):
            • "(A-Z)" annotates pickers whose options are sorted by
              label_en (loadTaxonomy v4 — see src/lib/taxonomy.ts).
              Operator can scan top-to-bottom alphabetically without
              second-guessing the layout.
            • Colors does NOT get the marker — its sort_order is the
              hue ramp (white → grey → gold → red → … → black), not
              alpha. Adding "(A-Z)" there would be a lie.
            • Store locations does NOT get the marker — RegionsPicker
              groups by geography (north / central / south / …) and
              orders by reading-order within group, not alpha.
            • Subtype gets "(A-Z)" because the SubtypePicker scopes
              its options to the current item_type, and within that
              scope the rows come out of taxonomy.itemSubtypes in
              alpha order. If no item_type is picked yet, the picker
              shows nothing — the marker stays accurate either way.
        */}

        <Section
          title="Rooms * (A-Z)"
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
          title="Item type * (A-Z)"
          hint="Pick one — what kind of thing this is."
        >
          <PillGrid
            form={FORM_ID}
            name="item_type"
            options={itemTypeOptions}
            initial={p?.item_type ?? null}
          />
        </Section>

        <Section
          title="Subtype (A-Z)"
          hint="Optional shape/style variant of the picked item type (e.g. Faucet → Pull-out / Sensor)."
        >
          <SubtypePicker
            form={FORM_ID}
            subtypes={taxonomy.itemSubtypes}
            initial={p?.subtype_slug ?? null}
            initialItemType={p?.item_type ?? null}
          />
        </Section>

        <Section title="Styles (multi · A-Z)">
          <PillGrid
            form={FORM_ID}
            name="styles"
            multi
            options={taxonomy.styles.map((r) => ({
              slug: r.slug,
              label: r.label_en,
              label_zh: r.label_zh,
              label_ms: r.label_ms,
            }))}
            initial={p?.styles ?? []}
          />
        </Section>

        <Section title="Colors (multi)">
          {/* No "(A-Z)" — sort_order encodes the hue ramp. Colors
              stay single-line under each swatch — the dot IS the
              meaning, the label is a hint. Stacking 3 lines of
              text under a 36px swatch wastes vertical space without
              improving comprehension. ZH/MS still editable on the
              taxonomy page chip. */}
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

        <Section title="Materials (multi · A-Z)">
          <PillGrid
            form={FORM_ID}
            name="materials"
            multi
            options={taxonomy.materials.map((r) => ({
              slug: r.slug,
              label: r.label_en,
              label_zh: r.label_zh,
              label_ms: r.label_ms,
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
            <SubmitButtons isEdit={isEdit} busy={busy} />
          </div>
        </footer>

        {isEdit && (
          <SavedToast show={Boolean(freshlyCreated)} productId={p!.id} />
        )}
      </div>
    </StagedUploadsProvider>
  );
}

/**
 * F6 submit triad: one row of three buttons in both header and
 * footer, each distinguished by the `intent` FormData key
 * (browsers include the CLICKED button's name+value on submit).
 *
 *   - Save            → intent=save      → respect the Status pill;
 *                                           published ⇒ rembg kicks
 *   - Save as Draft   → intent=draft     → force status=draft; no rembg
 *   - Publish         → intent=publish   → force status=published + rembg
 *
 * parsePayload in products/actions.ts reads `intent` and overrides
 * the status accordingly. The rembg-kick-gate also reads intent so
 * Save-as-Draft NEVER spends rembg money. Publish is emerald, Draft
 * is amber, Save is neutral — so the destructive "goes live" action
 * stands out.
 *
 * On /products/new (isEdit=false) we collapse to just "Create
 * product" because a new row is always created as draft (no images
 * yet, no rooms to confirm publish-readiness against).
 */
function SubmitButtons({ isEdit, busy }: { isEdit: boolean; busy: boolean }) {
  if (!isEdit) {
    return (
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="draft"
        disabled={busy}
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-wait disabled:opacity-60"
      >
        {busy ? "Working…" : "Create product"}
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
        disabled={busy}
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60"
        title="Save and mark as draft — nothing gets rembg'd"
      >
        Save as Draft
      </button>
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="save"
        disabled={busy}
        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:border-black disabled:cursor-wait disabled:opacity-60"
        title="Save with the status currently selected above"
      >
        Save
      </button>
      <button
        type="submit"
        form={FORM_ID}
        name="intent"
        value="publish"
        disabled={busy}
        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        title="Save, publish, and run background removal on raw images"
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
