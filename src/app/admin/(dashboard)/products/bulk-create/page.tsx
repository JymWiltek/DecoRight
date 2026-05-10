import "server-only";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import BulkCreateForm from "@/components/admin/BulkCreateForm";

export const dynamic = "force-dynamic";

/**
 * Wave 6 · Commit 4 — bulk-create page.
 *
 * Operator drops 1-10 products' photos (and optionally their GLBs)
 * into stacked cards, clicks "Save all & create drafts", and the
 * client-side handler:
 *   1. mints a productId UUID per card
 *   2. for each photo: getSignedUploadUrl("raw_image", productId,
 *      filename, mime) → PUT bytes (parallel within & across cards)
 *   3. for each GLB: same flow with kind="glb" + checkGlbBudget
 *      (lib/admin/glb-budget) at pick time
 *   4. when every byte landed, calls bulkCreateProducts(drafts)
 *      which inserts product rows + product_images + GLB columns,
 *      then schedules rembg + parseImagesMerged in a next/server
 *      `after` tail.
 *
 * The actual list refresh + AI-fill are async — the operator gets
 * sent back to /admin where the rows show up at status='draft' with
 * "Untitled product" + ⚠️ AI-completeness flags. Within ~30s the
 * tail finishes and the names / SKUs / dimensions populate; refresh
 * shows ✅.
 */
export default async function BulkCreatePage() {
  await requireAdmin();

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 pb-32">
      <div className="mb-6 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Bulk create products</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Up to 10 products at once. Each card: 1-5 photos +
            optional 3D model. After save, AI auto-fill runs in the
            background — refresh /admin in ~30s to see filled fields.
          </p>
        </div>
        <Link
          href="/admin"
          className="text-sm text-neutral-700 hover:text-black"
        >
          ← Back to products
        </Link>
      </div>
      <BulkCreateForm />
    </div>
  );
}
