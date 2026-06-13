import Link from "next/link";
import type { Metadata } from "next";
import { BRAND } from "@config/brand";
import { designerLogin } from "../actions";

export const metadata: Metadata = { title: "Designer Login" };

const ERRORS: Record<string, string> = {
  missing: "Enter your email and password.",
  bad: "Email or password is incorrect.",
  suspended: "This account is suspended — contact DecoRight.",
};

type Props = {
  searchParams: Promise<{ error?: string; next?: string }>;
};

export default async function DesignerLoginPage({ searchParams }: Props) {
  const { error, next } = await searchParams;
  const msg = error ? ERRORS[error] ?? "Could not sign in." : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <Link href="/" className="mb-8 text-lg font-bold tracking-tight text-neutral-900">
        {BRAND.name}
      </Link>
      <h1 className="text-2xl font-semibold text-neutral-900">Designer sign in</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Sign in to download FBX/GLB with your credit.
      </p>

      {msg && (
        <div className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {msg}
        </div>
      )}

      <form action={designerLogin} className="mt-6 flex flex-col gap-3">
        {next && <input type="hidden" name="next" value={next} />}
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
          placeholder="Password"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          Sign in
        </button>
      </form>

      <p className="mt-4 text-sm text-neutral-500">
        New here?{" "}
        <Link
          href={next ? `/designer/register?next=${encodeURIComponent(next)}` : "/designer/register"}
          className="font-medium text-neutral-900 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </main>
  );
}
