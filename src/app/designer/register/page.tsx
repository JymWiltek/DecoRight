import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@config/brand";
import { designerRegister } from "../actions";

export const metadata: Metadata = { title: "Designer Register" };

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  weak: "Password must be at least 6 characters.",
  name: "Enter your name.",
  taken: "An account with this email already exists.",
  db: "Could not create the account — try again.",
};

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function DesignerRegisterPage({ searchParams }: Props) {
  const { error, next } = await searchParams;
  const msg = error ? ERRORS[error] ?? "Could not register." : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-lg font-bold tracking-tight text-neutral-900">
        {BRAND.name}
      </Link>
      <h1 className="text-2xl font-semibold text-neutral-900">Create designer account</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Download FBX/GLB for your projects. Credit is topped up via WhatsApp.
      </p>

      {msg && (
        <div className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {msg}
        </div>
      )}

      <form action={designerRegister} className="mt-6 flex flex-col gap-3">
        {next && <input type="hidden" name="next" value={next} />}
        <input
          type="text"
          name="name"
          required
          placeholder="Your name / studio"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <input
          type="email"
          name="email"
          required
          placeholder="you@studio.com"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <input
          type="password"
          name="password"
          required
          minLength={6}
          placeholder="Password (min 6 chars)"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Create account
        </button>
      </form>

      <p className="mt-4 text-sm text-neutral-500">
        Already have an account?{" "}
        <Link
          href={next ? `/designer/login?next=${encodeURIComponent(next)}` : "/designer/login"}
          className="font-medium text-neutral-900 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
