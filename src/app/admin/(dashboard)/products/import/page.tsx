import "server-only";
import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import ImportClient from "./ImportClient";

export const dynamic = "force-dynamic";

export default async function ImportProductsPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Import from Excel</h1>
          <p className="mt-1 max-w-2xl text-sm text-neutral-600">
            Update existing products in bulk. Rows are matched by{" "}
            <strong>id</strong> (or <strong>sku</strong> if id is blank).{" "}
            <strong>Blank cells are left unchanged</strong> — this only fills /
            edits, it never creates, deletes, or clears fields, and it never
            changes status. You&rsquo;ll confirm a preview before anything is
            written.
          </p>
        </div>
        <Link
          href="/admin"
          className="shrink-0 text-sm text-sky-600 hover:underline"
        >
          ← Back to products
        </Link>
      </div>
      <ImportClient />
    </div>
  );
}
