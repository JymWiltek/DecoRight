import Link from "next/link";
import { BRAND } from "@config/brand";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/admin" className="text-sm font-semibold">
            {BRAND.name} · 管理后台
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-600">
            <Link href="/admin" className="hover:text-black">
              商品
            </Link>
            <Link href="/admin/products/new" className="hover:text-black">
              新增
            </Link>
            <Link href="/admin/cutouts" className="hover:text-black">
              抠图审核
            </Link>
            <Link href="/admin/taxonomy" className="hover:text-black">
              分类管理
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-xs text-neutral-500">
          <Link href="/" className="hover:text-black">
            查看前台 →
          </Link>
          <form action="/admin/logout" method="POST">
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1 hover:border-black"
            >
              退出
            </button>
          </form>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
