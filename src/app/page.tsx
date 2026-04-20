import { BRAND } from "@config/brand";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">
        {BRAND.name}
      </h1>
      <p className="mt-4 text-lg text-neutral-600 dark:text-neutral-400">
        {BRAND.tagline}
      </p>
      <p className="mt-12 text-xs uppercase tracking-widest text-neutral-400">
        Phase 1 · scaffolding
      </p>
    </main>
  );
}
