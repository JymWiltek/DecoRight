import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center px-4 text-center">
      <h1 className="text-2xl font-semibold">未找到该商品</h1>
      <p className="mt-2 text-sm text-neutral-600">
        可能已被下架，或链接已失效。
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center justify-center rounded-md bg-black px-5 py-3 text-sm font-medium text-white hover:bg-neutral-800"
      >
        返回目录
      </Link>
    </main>
  );
}
