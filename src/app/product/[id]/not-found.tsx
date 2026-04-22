import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const [tp, ts] = await Promise.all([
    getTranslations("product"),
    getTranslations("site"),
  ]);
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">{tp("notFound")}</h1>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-md bg-black px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800"
      >
        {ts("backToCatalog")}
      </Link>
    </main>
  );
}
