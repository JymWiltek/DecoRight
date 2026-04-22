"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import ModelViewer from "./ModelViewer";
import ColorSwitcher, { type ColorOption } from "./ColorSwitcher";
import { formatMYR } from "@/lib/format";
import type { ProductRow } from "@/lib/supabase/types";

type Props = {
  product: ProductRow;
  itemTypeLabel: string | null;
  roomLabels: string[];
  styleLabels: string[];
  materialLabels: string[];
  colors: ColorOption[]; // tags from taxonomy, used for both filter + 3D switcher
};

export default function ProductDetail({
  product,
  itemTypeLabel,
  roomLabels,
  styleLabels,
  materialLabels,
  colors,
}: Props) {
  const t = useTranslations("product");
  const [variantIndex, setVariantIndex] = useState(0);
  const active = colors[variantIndex];
  const overrideColorHex = active?.hex ?? null;

  return (
    <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-neutral-100">
        {product.glb_url ? (
          <ModelViewer
            src={product.glb_url}
            alt={product.name}
            poster={product.thumbnail_url}
            overrideColorHex={overrideColorHex}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-neutral-400">
            {t("noModel")}
          </div>
        )}
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
          {roomLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("room")}</dt>
              <dd>{roomLabels.join("、")}</dd>
            </>
          )}
          {styleLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("style")}</dt>
              <dd>{styleLabels.join("、")}</dd>
            </>
          )}
          {materialLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">{t("material")}</dt>
              <dd>{materialLabels.join("、")}</dd>
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

        <div className="text-xs text-neutral-500">
          {t("arHintLine1")}
          <br />
          {t("arHintLine2")}
        </div>
      </div>
    </div>
  );
}
