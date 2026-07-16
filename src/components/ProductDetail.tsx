"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import ProductGallery from "./ProductGallery";
import ColorSwitcher, { type ColorOption } from "./ColorSwitcher";
import FbxDownloadButton from "./FbxDownloadButton";
import WhereToBuy, { type WhereToBuyChannel } from "./WhereToBuy";
import ConsumerAuthModal from "./ConsumerAuthModal";
import { consumerSignOut } from "@/app/auth/actions";
import { buildFbxDownload, formatMYR } from "@/lib/format";
import { waLink } from "@/lib/whatsapp";
import { glbUrlForGallery } from "@/lib/glb-display";
import type { ProductRow } from "@/lib/supabase/types";

// PB3-B item 6 — free AR quota. A logged-out visitor may open AR on up to
// this many DISTINCT products (tracked by product id in localStorage) before
// the sign-in modal appears. Per-product, not per-click: re-opening a product
// already in the list is free and doesn't consume a slot. This is lead
// capture, not DRM — incognito / cleared storage resets it, by design.
const AR_FREE_LIMIT = 3;
const AR_QUOTA_KEY = "dr_ar_free_products";

function readArQuota(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(AR_QUOTA_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// PB3-B item 3 — layout signal. Which CTA is primary is a device form-factor
// decision, so it reads the viewport's pointer type, NOT model-viewer's
// canActivateAR: canActivateAR is only known post-load and is false in every
// non-AR context (desktop AND headless/emulated mobile), so it can't drive a
// stable, SSR-safe, screenshot-verifiable layout. `(pointer: coarse)` = a
// touch device (phone/tablet, where AR works), excluding mouse desktops (the
// dead-end Amazon avoids). activateAR() still rejects gracefully if a specific
// touch device lacks AR.
function useIsTouchDevice(): boolean {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setTouch(mq.matches);
    const on = () => setTouch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return touch;
}

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
  /** Wave 5 (mig 0038) — flat image-pool model. Every show_on_storefront
   *  image becomes a gallery slide, primary thumbnail first, then
   *  by upload time. Server-resolved to public-or-signed URLs already.
   *  Empty array → gallery falls back to its empty-state placeholder. */
  galleryUrls: string[];
  /** Sprint 1 C2 — whether the current visitor is a logged-in designer.
   *  Drives the FBX button (login CTA vs credit-deduct download). */
  designerLoggedIn: boolean;
  /** Mig 0048 — "Where to buy" channels (server-resolved + sorted) +
   *  the verified badge flag + lead-capture contacts. */
  whereToBuy: WhereToBuyChannel[];
  isVerifiedRealProduct: boolean;
  leadEmail: string;
  leadWhatsapp: string;
  /** Absolute product-page URL (server-resolved) for the WhatsApp text. */
  productUrl: string;
  /** Feature 6 — AR login gate. arUnlocked = a logged-in consumer (Supabase
   *  Auth); consumerEmail powers the "signed in as …" line. Logged-out
   *  visitors browse everything freely but must sign in to launch AR. */
  arUnlocked: boolean;
  consumerEmail: string | null;
};

export default function ProductDetail({
  product,
  itemTypeLabel,
  roomLabels,
  styleLabels,
  materialLabels,
  colors,
  regionLabels,
  galleryUrls,
  designerLoggedIn,
  whereToBuy,
  isVerifiedRealProduct,
  leadEmail,
  leadWhatsapp,
  productUrl,
  arUnlocked,
  consumerEmail,
}: Props) {
  const t = useTranslations("product");
  const tWhere = useTranslations("whereToBuy");
  const locale = useLocale();
  const router = useRouter();
  // Feature 6 — AR login gate: the modal opens when a logged-out visitor
  // taps the AR button (handled inside ProductGallery → ModelViewer).
  const [loginOpen, setLoginOpen] = useState(false);
  const arNextPath = (() => {
    try {
      return new URL(productUrl).pathname;
    } catch {
      return `/product/${product.id}`;
    }
  })();
  const handleSignOut = async () => {
    await consumerSignOut();
    router.refresh();
  };
  // Locale-correct list joiner — `、` for zh, `, ` for en/ms. Built
  // into the runtime; no extra i18n key needed. `style: "narrow"`
  // drops the "and"/"dan" conjunction before the last item to keep
  // these dense facet lists compact (e.g. "Modern, Minimalist,
  // Japanese" rather than "Modern, Minimalist, and Japanese").
  // type: "conjunction" picks the right separator per locale; "unit"
  // would emit just spaces (it's for "5 ft 3 in" patterns).
  const listFormatter = new Intl.ListFormat(locale, { style: "narrow", type: "conjunction" });
  // Color preview is OPT-IN. Default (null) shows the product exactly as
  // uploaded — the GLB's real materials and the original images. Only a
  // deliberate swatch click recolors the 3D model. Previously this
  // defaulted to index 0, which silently repainted the model to the
  // product's first color tag on load — a product tagged "black" rendered
  // as a flat-black model before the visitor touched anything.
  const [variantIndex, setVariantIndex] = useState<number | null>(null);
  const active = variantIndex == null ? null : colors[variantIndex];
  const overrideColorHex = active?.hex ?? null;
  const fbxDownload = buildFbxDownload(product);

  // PB3-B item 3 — device form factor drives which CTA is primary.
  const isTouchDevice = useIsTouchDevice();
  // PB3-B — ModelViewer publishes its AR launcher here; the primary CTA
  // calls it after the free-quota / login check.
  const arLaunchRef = useRef<(() => void) | null>(null);

  // PB3-B item 6 — AR launch decision. Logged-in consumers: unlimited.
  // Logged-out: first AR_FREE_LIMIT distinct products are free, then the
  // sign-in modal. A product already viewed is always free (no re-consume).
  const handleArClick = () => {
    if (arUnlocked) {
      arLaunchRef.current?.();
      return;
    }
    const seen = readArQuota();
    if (!seen.includes(product.id)) {
      if (seen.length >= AR_FREE_LIMIT) {
        setLoginOpen(true);
        return;
      }
      try {
        localStorage.setItem(
          AR_QUOTA_KEY,
          JSON.stringify([...seen, product.id]),
        );
      } catch {
        // localStorage unavailable → don't block (lead capture, not DRM).
      }
    }
    arLaunchRef.current?.();
  };

  // PB3-B item 3 — the primary CTA's WhatsApp target. Prefer the cheapest
  // channel that carries a number (whereToBuy is pre-sorted cheapest-first),
  // else the global lead number; falls back to email when no number exists —
  // exactly the priority WhereToBuy uses, so the shortcut and the detailed
  // card agree.
  const primaryWaText =
    tWhere("waText", { name: product.name, url: productUrl }) +
    (product.sku_id ? ` (SKU: ${product.sku_id})` : "");
  const channelWhatsapp = whereToBuy.find((c) => c.whatsapp)?.whatsapp ?? null;
  const primaryWaHref =
    waLink(channelWhatsapp ?? leadWhatsapp, primaryWaText) ||
    `mailto:${leadEmail}?subject=${encodeURIComponent(
      `Enquiry: ${product.name}${product.sku_id ? ` (${product.sku_id})` : ""}`,
    )}`;

  // Installation method — a controlled-vocab slug in attributes.mounting
  // (AI-filled from the spec sheet). Map known slugs to a localized label;
  // fall back to a de-slugified string for anything unexpected.
  const INSTALL_SLUGS = new Set([
    "wall_mounted",
    "floor_standing",
    "counter_top",
    "wall_hung",
    "under_mount",
    "semi_recessed",
    "free_standing",
    "built_in",
    "deck_mounted",
  ]);
  const mountingRaw =
    typeof product.attributes?.mounting === "string"
      ? product.attributes.mounting.trim()
      : "";
  const mountingLabel = mountingRaw
    ? INSTALL_SLUGS.has(mountingRaw)
      ? t(`install_${mountingRaw}`)
      : mountingRaw.replace(/_/g, " ")
    : null;

  // Wave: AR true-size. When the product has real dimensions, point the
  // viewer at /api/ar-glb/<id>, which bakes dimensions_mm into the GLB so
  // Android scene-viewer / iOS quick-look (which ignore <model-viewer>'s
  // runtime `scale`) place it at true size. No dims → the plain gallery
  // GLB (the route also 302s back to it on any failure). realDimensionsMm
  // is still forwarded so the inline view self-corrects if the route
  // falls back.
  const galleryGlbUrl = glbUrlForGallery(product);
  // Cache-bust the AR GLB on BOTH the model file version and the dimensions:
  // editing dimensions_mm must invalidate the immutable-cached scaled GLB,
  // or AR keeps the old size.
  const dimsSig = product.dimensions_mm
    ? `${product.dimensions_mm.length ?? 0}x${product.dimensions_mm.width ?? 0}x${product.dimensions_mm.height ?? 0}`
    : "0";
  const modelSrc =
    galleryGlbUrl && product.dimensions_mm
      ? `/api/ar-glb/${product.id}?v=${galleryGlbUrl.match(/[?&]v=([^&]+)/)?.[1] ?? "1"}-${dimsSig}`
      : galleryGlbUrl;

  // Colour swatches only make sense for models with separable materials.
  // ModelViewer reports the material count once the GLB loads; until then
  // (and for single-material / no-3D products) the switcher stays hidden,
  // so we never show a swatch that does nothing.
  const [modelMaterialCount, setModelMaterialCount] = useState<number | null>(null);

  const hasModel = !!modelSrc;
  // Primary = biggest, black; secondary = smaller, outline. The size gap is
  // deliberate (PB3-B item 3 — the primary CTA must read as dominant).
  const primaryBtn =
    "inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-black px-5 py-3.5 text-base font-semibold text-white transition hover:bg-neutral-800";
  const secondaryBtn =
    "inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-5 py-2.5 text-sm font-medium text-neutral-800 transition hover:border-neutral-500";

  return (
    <div className="grid gap-8 md:grid-cols-[1.2fr_1fr]">
      <ProductGallery
        productName={product.name}
        // Decoded-budget gate (lib/glb-display): nulls the URL for
        // GLBs whose persisted vertex/texture/RAM metadata exceeds
        // iOS-Safari-safe thresholds, so <model-viewer> never mounts
        // for those products. ProductGallery falls through to its
        // styled-thumbnail slide. Other consumers of product.glb_url
        // (e.g. the Download .glb button below) still see the real
        // URL — only the in-page 3D viewer is gated.
        glbUrl={modelSrc}
        galleryUrls={galleryUrls}
        primaryThumbnailUrl={product.thumbnail_url}
        overrideColorHex={overrideColorHex}
        // Wave 9 — pipe real dimensions through so ModelViewer can
        // uniformly rescale the loaded model to actual product size
        // in AR. Null = legacy product without dimensions entered;
        // ModelViewer falls back to intrinsic scale (the model's
        // own bbox in meters).
        realDimensionsMm={product.dimensions_mm ?? null}
        onMaterialCount={setModelMaterialCount}
        emptyLabel={t("noImages")}
        arLaunchRef={arLaunchRef}
      />

      <div className="flex flex-col gap-5">
        <div>
          {product.brand && (
            <div className="text-sm uppercase tracking-wide text-neutral-500">
              {product.brand}
            </div>
          )}
          <h1 className="mt-1 text-2xl font-semibold">{product.name}</h1>
          {/* Mig 0048 — DecoRight-verified real product badge. */}
          {isVerifiedRealProduct && (
            <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
              <span aria-hidden>✓</span>
              {tWhere("verified")}
            </div>
          )}
        </div>

        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-semibold">
            {formatMYR(product.price_myr)}
          </span>
          {/* mig 0047 — struck-through original/RCP price when a real
              discount is recorded (original strictly above selling). */}
          {product.price_original_myr != null &&
            product.price_myr != null &&
            product.price_original_myr > product.price_myr && (
              <span className="text-lg text-neutral-400 line-through">
                {formatMYR(product.price_original_myr)}
              </span>
            )}
        </div>

        {colors.length > 0 && (modelMaterialCount ?? 0) > 1 && (
          <ColorSwitcher
            colors={colors}
            activeIndex={variantIndex ?? -1}
            onChange={setVariantIndex}
          />
        )}

        {/* PB3-B item 3 — device-gated primary CTA. Touch device: AR is the
            biggest (black) button, WhatsApp second. Desktop: WhatsApp is the
            primary black button and AR is hidden (no dead-end on a device that
            can't run it), followed by the item-4 hint to open on a phone. */}
        <div className="flex flex-col gap-2">
          {isTouchDevice ? (
            <>
              {hasModel && (
                <button type="button" onClick={handleArClick} className={primaryBtn}>
                  <span aria-hidden>📱</span> {t("arViewInAR")}
                </button>
              )}
              <a
                href={primaryWaHref}
                target="_blank"
                rel="noopener noreferrer"
                className={secondaryBtn}
              >
                <span aria-hidden>💬</span> {tWhere("whatsappRetailer")}
              </a>
            </>
          ) : (
            <>
              <a
                href={primaryWaHref}
                target="_blank"
                rel="noopener noreferrer"
                className={primaryBtn}
              >
                <span aria-hidden>💬</span> {tWhere("whatsappRetailer")}
              </a>
              {hasModel && (
                <p className="text-xs italic text-neutral-500">
                  {t("openOnPhone")}
                </p>
              )}
            </>
          )}
        </div>

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
          {/* SKU row (PB3-B item 5) — empty value → row not rendered. No
              em-dash / N-A placeholder; every spec row hides when blank,
              matching Kohler / IKEA / Wayfair. */}
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
          {/* Dimensions as three separate rows — W / D / H (mm). Mapping is
              evidence-based: a "600 mm vanity" stores length=600, so the
              stored `length` is the physical Width, `width` is the Depth. */}
          {product.dimensions_mm?.length != null && (
            <>
              <dt className="text-neutral-500">{t("dimWidth")}</dt>
              <dd>{t("mmValue", { n: product.dimensions_mm.length })}</dd>
            </>
          )}
          {product.dimensions_mm?.width != null && (
            <>
              <dt className="text-neutral-500">{t("dimDepth")}</dt>
              <dd>{t("mmValue", { n: product.dimensions_mm.width })}</dd>
            </>
          )}
          {product.dimensions_mm?.height != null && (
            <>
              <dt className="text-neutral-500">{t("dimHeight")}</dt>
              <dd>{t("mmValue", { n: product.dimensions_mm.height })}</dd>
            </>
          )}
          {/* Installation method (attributes.mounting). AI fills it from the
              spec sheet; shown as a controlled-vocab label. */}
          {mountingLabel && (
            <>
              <dt className="text-neutral-500">{t("installation")}</dt>
              <dd>{mountingLabel}</dd>
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

        {/* Sprint 1 — only render Buy Now when there's a real purchase
            link. The old disabled "No purchase link yet" button made the
            page feel half-built; drop it entirely when absent. */}
        {product.purchase_url && (
          <a
            href={product.purchase_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
          >
            {t("buyNow")}
          </a>
        )}

        {/* PB3-B item 1 — the free "Download 3D model (.glb)" button was
            removed: giving the GLB away undercuts the paid designer-download
            business. The GLB file, AR, and the in-page 3D viewer are
            untouched — only the download ENTRY POINT is gone. */}

        {/* Sprint 1 C2 — Download .fbx is gated behind designer login +
            credit. PB3-B item 2 renders it as a low-emphasis one-line link,
            not a button-weight block. */}
        {fbxDownload && (
          <FbxDownloadButton
            productId={product.id}
            creditCost={product.download_credit_cost}
            fbxSizeKb={product.fbx_size_kb}
            designerLoggedIn={designerLoggedIn}
            loginHref={`/designer/login?next=${encodeURIComponent(`/product/${product.id}`)}`}
          />
        )}

        {/* Mig 0048 — "Where to buy" (real purchasable product). Directly
            below the download/get area, per spec. Always renders (3 states,
            never a dead end). */}
        <WhereToBuy
          channels={whereToBuy}
          productName={product.name}
          productUrl={productUrl}
          sku={product.sku_id}
          leadEmail={leadEmail}
          leadWhatsapp={leadWhatsapp}
        />

        {/* Wave 12 — Style Tags (#Modern #Minimalist). */}
        {styleLabels.length > 0 && (
          <div className="flex flex-wrap gap-2 border-t border-neutral-100 pt-4">
            {styleLabels.map((s) => (
              <span
                key={s}
                className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600"
              >
                #{s.replace(/\s+/g, "")}
              </span>
            ))}
          </div>
        )}

        {/* Feature 6 — AR login-gate hint. Logged out: explain the free
            sign-in unlock. Logged in: confirm unlocked + who's signed in,
            with a sign-out affordance. */}
        <div className="text-xs text-neutral-500">
          {arUnlocked ? (
            <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="font-medium text-emerald-600">
                ✓ {t("arUnlockedHint")}
              </span>
              {consumerEmail && (
                <>
                  <span className="text-neutral-300">·</span>
                  <span>{t("signedInAs", { email: consumerEmail })}</span>
                  <button
                    type="button"
                    onClick={handleSignOut}
                    className="underline underline-offset-2 hover:text-neutral-700"
                  >
                    {t("signOut")}
                  </button>
                </>
              )}
            </span>
          ) : (
            t("arGateHint")
          )}
        </div>
      </div>

      <ConsumerAuthModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        next={arNextPath}
      />
    </div>
  );
}
