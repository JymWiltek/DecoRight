"use client";

import { useState } from "react";
import ModelViewer from "./ModelViewer";
import ColorSwitcher from "./ColorSwitcher";
import { formatMYR } from "@/lib/format";
import type { ProductRow } from "@/lib/supabase/types";

type Props = { product: ProductRow };

export default function ProductDetail({ product }: Props) {
  const [variantIndex, setVariantIndex] = useState(0);
  const variants = product.color_variants ?? [];
  const active = variants[variantIndex];
  const basePrice = product.price_myr ?? 0;
  const adjusted = active ? basePrice + (active.price_adjustment_myr ?? 0) : basePrice;
  const buyUrl = active?.purchase_url_override || product.purchase_url || null;
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
            <div className="text-sm uppercase tracking-wide text-neutral-500">{product.brand}</div>
          )}
          <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>
        </div>

        <div className="text-3xl font-semibold">{formatMYR(adjusted)}</div>

        {variants.length > 0 && (
          <ColorSwitcher
            variants={variants}
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
          {product.category && (
            <>
              <dt className="text-neutral-500">分类</dt>
              <dd>{product.category}</dd>
            </>
          )}
          {product.style && (
            <>
              <dt className="text-neutral-500">风格</dt>
              <dd>{product.style}</dd>
            </>
          )}
          {product.material && (
            <>
              <dt className="text-neutral-500">材质</dt>
              <dd>{product.material}</dd>
            </>
          )}
          {product.installation && (
            <>
              <dt className="text-neutral-500">安装方式</dt>
              <dd>{product.installation}</dd>
            </>
          )}
          {product.dimensions_mm && (
            <>
              <dt className="text-neutral-500">尺寸 (mm)</dt>
              <dd>
                {[product.dimensions_mm.length, product.dimensions_mm.width, product.dimensions_mm.height]
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

        {buyUrl ? (
          <a
            href={buyUrl}
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
