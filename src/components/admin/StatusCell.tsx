/**
 * Wave 2B · Commit 9 — read-only status badge.
 *
 * Used to be: clickable popover with four pills + Save / Cancel
 * buttons that fired setProductStatusAction inline.
 *
 * Now: a non-interactive badge (rendered as a Link to the edit
 * page). Publish-flow γ redesign locks every status flip behind
 * the form's 3-gate enforcement — we can't honor that from a
 * one-click inline pill without either duplicating the gate
 * machinery (which would drift) or surfacing the gate failures
 * in a tooltip-sized popover (which would be unusable). The
 * cleanest answer is to make every status change go through the
 * edit page, where the gates already render proper guidance.
 *
 * Why no "use client": this is now pure markup, no event handlers
 * or hooks. Static <Link> renders fine from a Server Component.
 *
 * Why we kept the file (instead of inlining the badge in page.tsx):
 * the styling map STATUS_STYLES is still per-cell logic, and the
 * StatusCell name is referenced from /admin/page.tsx imports we
 * don't want to churn.
 */

import Link from "next/link";
import {
  type ProductStatus,
} from "@/lib/constants/enums";
import { PRODUCT_STATUS_LABELS } from "@/lib/constants/enum-labels";

const STATUS_STYLES: Record<ProductStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-amber-100 text-amber-800",
  link_broken: "bg-red-100 text-red-700",
};

type Props = {
  productId: string;
  current: ProductStatus;
};

export default function StatusCell({ productId, current }: Props) {
  return (
    <Link
      href={`/admin/products/${productId}/edit`}
      className={`inline-block rounded-full px-2 py-0.5 text-xs transition hover:opacity-80 ${STATUS_STYLES[current]}`}
      title="Open the edit page to change status (Publish requires rooms + cutouts + GLB)"
    >
      {PRODUCT_STATUS_LABELS[current]}
    </Link>
  );
}
