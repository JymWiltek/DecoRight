import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createDesignerAction } from "../actions";

/**
 * Wave 10 — new designer form. Minimal fields (email, name, whatsapp,
 * admin_note). Self-login + password set lands later; admin onboards
 * the row, then tops up credit manually.
 */
export default async function NewDesignerPage({
  searchParams,
}: {
  searchParams?: Promise<{ err?: string; msg?: string }>;
}) {
  await requireAdmin();
  const sp = (await searchParams) ?? {};

  return (
    <div className="mx-auto max-w-xl p-6">
      <div className="mb-4 flex items-center gap-3">
        <Link
          href="/admin/designers"
          className="text-sm text-sky-700 hover:underline"
        >
          ← Designers
        </Link>
      </div>
      <h1 className="text-xl font-semibold">New designer</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Wave 10 — admin onboarding. The designer can't log in yet;
        you'll top up their credit manually and they'll download via
        admin links until the designer front-end ships.
      </p>

      {sp.err && (
        <div className="mt-3 rounded bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <strong>{sp.err}</strong>: {sp.msg ?? ""}
        </div>
      )}

      <form action={createDesignerAction} className="mt-6 space-y-4">
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Email
          </label>
          <input
            name="email"
            type="email"
            required
            placeholder="designer@example.com"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Name
          </label>
          <input
            name="name"
            type="text"
            required
            placeholder="Full name"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            WhatsApp (optional)
          </label>
          <input
            name="whatsapp"
            type="text"
            placeholder="+60 12 345 6789"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium uppercase text-neutral-500">
            Admin note (optional)
          </label>
          <textarea
            name="admin_note"
            rows={2}
            placeholder="How did they sign up? Who referred them?"
            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Create designer
          </button>
        </div>
      </form>
    </div>
  );
}
