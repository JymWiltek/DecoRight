"use client";

/**
 * Mig 0048 — storefront "Where to buy" module. Sits directly below the
 * download/get area on the product page. Three states, NEVER a disabled
 * button or blank:
 *   1. Channels with links → cards (name · type · region · price · stock)
 *      with the best CTA: Buy → WhatsApp enquiry (prefilled) → View store
 *      → Visit brand site. Cheapest channel first.
 *   2. Channels but no link → the same cards fall back to WhatsApp / brand
 *      site / enquire, so a brand-only listing still acts.
 *   3. No channels at all → a lead-capture card (WhatsApp / email) so the
 *      empty state becomes an enquiry, not a dead end.
 */

import { useTranslations } from "next-intl";
import { formatMYR } from "@/lib/format";
import { waLink } from "@/lib/whatsapp";
import type { SupplierType, StockStatus } from "@/lib/constants/enums";

export type WhereToBuyChannel = {
  supplierName: string;
  type: SupplierType;
  regionLabel: string;
  priceMyr: number | null;
  stockStatus: StockStatus;
  buyUrl: string | null;
  storeAddress: string | null;
  websiteUrl: string | null;
  whatsapp: string | null;
  isExclusive: boolean;
};

const TYPE_BADGE: Record<SupplierType, string> = {
  official: "Official",
  dealer: "Dealer",
  store: "Store",
  marketplace: "Marketplace",
};

export default function WhereToBuy({
  channels,
  productName,
  sku,
  leadEmail,
  leadWhatsapp,
}: {
  channels: WhereToBuyChannel[];
  productName: string;
  sku: string | null;
  leadEmail: string;
  leadWhatsapp: string;
}) {
  const t = useTranslations("whereToBuy");
  const waText =
    t("waText", { name: productName }) + (sku ? ` (SKU: ${sku})` : "");
  // Lead-capture WhatsApp (no-channel state). null when BRAND.whatsapp
  // is unset / unnormalizable → that state shows email only.
  const leadWa = waLink(leadWhatsapp, waText);
  const stockLabel = (s: StockStatus) =>
    s === "in_stock"
      ? t("stockIn")
      : s === "order"
        ? t("stockOrder")
        : t("stockDiscontinued");

  const primaryBtn =
    "inline-flex items-center justify-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800";
  const secondaryBtn =
    "inline-flex items-center justify-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition hover:border-neutral-500";

  return (
    <div className="border-t border-neutral-100 pt-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
        {t("title")}
      </h2>

      {channels.length === 0 ? (
        // ── State 3: no channel → lead capture (never a dead end) ──
        <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4">
          <div className="text-sm font-medium text-neutral-900">
            {t("noChannelTitle")}
          </div>
          <p className="mt-1 text-xs text-neutral-500">{t("noChannelBody")}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {leadWa && (
              <a
                href={leadWa}
                target="_blank"
                rel="noopener noreferrer"
                className={primaryBtn}
              >
                {t("whatsapp")}
              </a>
            )}
            <a
              href={`mailto:${leadEmail}?subject=${encodeURIComponent(
                `Enquiry: ${productName}${sku ? ` (${sku})` : ""}`,
              )}`}
              className={leadWa ? secondaryBtn : primaryBtn}
            >
              {t("email")}
            </a>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {channels.map((c, i) => {
            const cta = (() => {
              if (c.buyUrl)
                return (
                  <a
                    href={c.buyUrl}
                    target="_blank"
                    rel="nofollow sponsored noopener noreferrer"
                    className={primaryBtn}
                  >
                    {t("buy")}
                  </a>
                );
              const channelWa = waLink(c.whatsapp, waText);
              if (channelWa)
                return (
                  <a
                    href={channelWa}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={primaryBtn}
                  >
                    {t("whatsapp")}
                  </a>
                );
              if (c.storeAddress)
                return (
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                      c.storeAddress,
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={secondaryBtn}
                  >
                    {t("viewStore")}
                  </a>
                );
              if (c.websiteUrl)
                return (
                  <a
                    href={c.websiteUrl}
                    target="_blank"
                    rel="nofollow noopener noreferrer"
                    className={secondaryBtn}
                  >
                    {t("visitSite")}
                  </a>
                );
              return (
                <a
                  href={`mailto:${leadEmail}?subject=${encodeURIComponent(
                    `Enquiry: ${productName}${sku ? ` (${sku})` : ""}`,
                  )}`}
                  className={secondaryBtn}
                >
                  {t("enquire")}
                </a>
              );
            })();

            return (
              <li
                key={`${c.supplierName}-${i}`}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-200 p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-neutral-900">
                      {c.supplierName}
                    </span>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600">
                      {TYPE_BADGE[c.type]}
                    </span>
                    {c.isExclusive && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        {t("exclusive")}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-neutral-500">
                    {c.regionLabel && <span>{c.regionLabel}</span>}
                    <span
                      className={
                        c.stockStatus === "in_stock"
                          ? "text-emerald-600"
                          : c.stockStatus === "order"
                            ? "text-amber-600"
                            : "text-neutral-400"
                      }
                    >
                      {stockLabel(c.stockStatus)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {c.priceMyr != null && (
                    <span className="text-base font-semibold text-neutral-900">
                      {formatMYR(c.priceMyr)}
                    </span>
                  )}
                  {cta}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
