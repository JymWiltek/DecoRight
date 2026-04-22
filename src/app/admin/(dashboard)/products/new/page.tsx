import Link from "next/link";
import { createProduct } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Minimal "start a new product" screen. We only ask for a name here
 * because image management lives on the edit workbench — and the
 * workbench needs a product id to hang images off. So: name →
 * createProduct (inserts a `status='draft'` row) → redirect to
 * /admin/products/[id]/edit where the operator fills in everything
 * else + uploads photos + flips status to 'published' via the Status
 * radio when they save.
 *
 * No image uploader here. No taxonomy pills. No nothing else. The
 * whole point is to get to the workbench as fast as possible.
 */
export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <header className="mb-6">
        <div className="text-xs text-neutral-500">
          <Link href="/admin" className="hover:text-black">
            ← Products
          </Link>
        </div>
        <h1 className="mt-2 text-2xl font-semibold">New product</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Give it a name to get started. You&rsquo;ll fill in the rest —
          images, taxonomy, price, 3D model — on the next screen.
        </p>
      </header>

      <form
        action={createProduct}
        className="space-y-4 rounded-lg border border-neutral-200 bg-white p-5"
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-neutral-600">Name *</span>
          <input
            name="name"
            required
            autoFocus
            placeholder="e.g. Walnut Coffee Table"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-black focus:outline-none"
          />
        </label>
        <p className="text-xs text-neutral-500">
          The product is saved as a draft. It won&rsquo;t appear on the
          public catalog until you flip Status to &ldquo;Published&rdquo;
          on the edit screen.
        </p>

        <div className="flex items-center justify-end gap-3 border-t border-neutral-100 pt-4">
          <Link
            href="/admin"
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:border-black"
          >
            Cancel
          </Link>
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create draft →
          </button>
        </div>
      </form>
    </div>
  );
}
