"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import ProductGallery from "./ProductGallery";
import RealPhotoStrip from "./RealPhotoStrip";
import ColorSwitcher, { type ColorOption } from "./ColorSwitcher";
import { buildGlbDownload, formatMYR } from "@/lib/format";
import { glbUrlForGallery } from "@/lib/glb-display";
import type { ProductRow } from "@/lib/supabase/types";

type Props = {
  product: ProductRow;
  itemTypeLabel: string | null;
  roomLabels: string[];
  styleLabels: string[];
  materialLabels: string[];
  colors: ColorOption[]; // tags from taxonomy, used for both filter + 3D switcher
  /** Pre-resolved region labels (in current locale) for the
   *  "Available in: …" line. Empty array = no regions = nationally
   *  available / unspecified, line is hidden. */
  regionLabels: string[];
  /** Signed URLs for the non-primary raw photos — slot 3+ in the
   *  gallery (scene shots after the styled thumbnail + 3D viewer). */
  originalRawUrls: string[];
  /** Wave 4 — signed URLs for operator-uploaded real product photos
   *  (image_kind='real_photo'). Rendered in a dedicated strip below
   *  the main gallery; click to open in a lightbox. Empty array
   *  hides the section entirely. */
  realPhotoUrls: string[];
};

export default function ProductDetail({
  product,
  itemTypeLabel,
  roomLabels,
  styleLabels,
  materialLabels,
  colors,
  regionLabels,
  originalRawUrls,
  realPhotoUrls,
}: Props) {
  const t = useTranslations("product");
  const locale = useLocale();
  // Locale-correct list joiner — `、` for zh, `, ` for en/ms. Built
  // into the runtime; no extra i18n key needed. `style: "narrow"`
  // drops the "and"/"dan" conjunction before the last item to keep
  // these dense facet lists compact (e.g. "Modern, Minimalist,
  // Japanese" rather than "Modern, Minimalist, and Japanese").
  // type: "conjunction" picks the right separator per locale; "unit"
  // would emit just spaces (it's for "5 ft 3 in" patterns).
  const listFormatter = new Intl.ListFormat(locale, { style: "narrow", type: "conjunction" });
  const [variantIndex, setVariantIndex] = useState(0);
  const active = colors[variantIndex];
  const overrideColorHex = active?.hex ?? null;
  const glbDownload = buildGlbDownload(product);

  return (
    <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
      <div>
      <ProductGallery
        productName={product.name}
        primaryCutoutUrl={product.thumbnail_url}
        // Decoded-budget gate (lib/glb-display): nulls the URL for
        // GLBs whose persisted vertex/texture/RAM metadata exceeds
        // iOS-Safari-safe thresholds, so <model-viewer> never mounts
        // for those products. ProductGallery falls through to its
        // styled-thumbnail slide. Other consumers of product.glb_url
        // (e.g. the Download .glb button below) still see the real
        // URL — only the in-page 3D viewer is gated.
        glbUrl={glbUrlForGallery(product)}
        originalRawUrls={originalRawUrls}
        overrideColorHex={overrideColorHex}
        emptyLabel={t("noImages")}
      />
      <RealPhotoStrip urls={realPhotoUrls} alt={product.name} />
      </div>

      <div className="flex flex-col gap-5">
        <div>
          {product.brand && (
            <div className="text-sm uppercase tracking-wide text-neutral-500">
              {product.brand}
            </div>
          )}
          <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>
        </div>

        <div className="text-3xl font-semibold">{formatMYR(product.price_myr)}</div>

        {colors.length > 0 && (
          <ColorSwitcher
            colors={colors}
            activeIndex={variantIndex}
            onChange={setVariantIndex}
          />
        )}

        {product.description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-700">
            {product.description}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-y-2 text-sm text-neutral-700">
          {itemTypeLabel && (
            <>
              <dt className="text-neutral-500">{t("itemType")}</dt>
              <dd>{itemTypeLabel}</dd>
            </>
          )}
          {/* SKU row — Wave 1 (mig 0033). Always rendered when sku_id
              is set, em-dash placeholder for null/blank so the column
              alignment doesn't shift when scanning across products. */}
          {product.sku_id && product.sku_id.trim() && (
            <>
              <dt className="text-neutral-500">{t("sku")}</dt>
              <dd>{product.sku_id}</dd>
            </>
          )}
          {roomLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("room")}</dt>
              <dd>{listFormatter.format(roomLabels)}</dd>
            </>
          )}
          {styleLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("style")}</dt>
              <dd>{listFormatter.format(styleLabels)}</dd>
            </>
          )}
          {materialLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("material")}</dt>
              <dd>{listFormatter.format(materialLabels)}</dd>
            </>
          )}
          {product.dimensions_mm && (
            <>
              <dt className="text-neutral-500">{t("dimensionsMm")}</dt>
              <dd>
                {[
                  product.dimensions_mm.length,
                  product.dimensions_mm.width,
                  product.dimensions_mm.height,
                ]
                  .filter((n) => n != null)
                  .join(" × ") || "—"}
              </dd>
            </>
          )}
          {product.weight_kg != null && (
            <>
              <dt className="text-neutral-500">{t("weight")}</dt>
              <dd>{t("weightValue", { kg: product.weight_kg })}</dd>
            </>
          )}
          {regionLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("availableIn")}</dt>
              <dd>{listFormatter.format(regionLabels)}</dd>
            </>
          )}
        </dl>

        {product.purchase_url ? (
          <a
            href={product.purchase_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            {t("buyNow")}
          </a>
        ) : (
          <button
            disabled
            className="inline-flex cursor-not-allowed items-center justify-center rounded-md bg-neutral-200 px-5 py-3 text-sm font-medium text-neutral-500"
          >
            {t("noPurchaseLink")}
          </button>
        )}

        {/* Download .glb — surfaced only when a model exists. The
            href carries `?download=<slug>.glb` so Supabase Storage
            replies with `Content-Disposition: attachment; filename=…`
            and the file lands on a designer's disk under a useful
            name; without that, browsers ignore the cross-origin
            `download` attr and the file is saved as plain
            "model.glb" — collides for every product they keep. See
            buildGlbDownload() for slug rules + UUID fallback for
            all-CJK names. */}
        {glbDownload && (
          <a
            href={glbDownload.href}
            download={glbDownload.filename}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md bg-neutral-100 px-5 py-3 text-sm font-medium text-neutral-800 transition hover:bg-neutral-200"
          >
            {t("downloadGlb")}
          </a>
        )}

        <div className="text-xs text-neutral-500">
          {t("arHintLine1")}
          <br />
          {t("arHintLine2")}
        </div>
      </div>
    </div>
  );
}
