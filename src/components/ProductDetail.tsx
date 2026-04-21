"use client";

import { useState } from "react";
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
            暂无 3D 模型
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
              <dt className="text-neutral-500">物件</dt>
              <dd>{itemTypeLabel}</dd>
            </>
          )}
          {roomLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">适用房间</dt>
              <dd>{roomLabels.join("、")}</dd>
            </>
          )}
          {styleLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">风格</dt>
              <dd>{styleLabels.join("、")}</dd>
            </>
          )}
          {materialLabels.length > 0 && (
            <>
              <dt className="text-neutral-500">材质</dt>
              <dd>{materialLabels.join("、")}</dd>
            </>
          )}
          {product.dimensions_mm && (
            <>
              <dt className="text-neutral-500">尺寸 (mm)</dt>
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
              <dt className="text-neutral-500">重量</dt>
              <dd>{product.weight_kg} kg</dd>
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
            前往购买 →
          </a>
        ) : (
          <button
            disabled
            className="inline-flex cursor-not-allowed items-center justify-center rounded-md bg-neutral-200 px-5 py-3 text-sm font-medium text-neutral-500"
          >
            暂无购买链接
          </button>
        )}

        <div className="text-xs text-neutral-500">
          点击模型右下角 AR 图标，用手机摄像头 1:1 预览该产品。
          <br />
          iOS 需要 USDZ（Phase 3 开放），当前 Android Scene Viewer 可用。
        </div>
      </div>
    </div>
  );
}
