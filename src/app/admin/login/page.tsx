import { BRAND } from "@config/brand";
import { login } from "./actions";

type PageProps = {
  searchParams: Promise<{ next?: string; error?: string }>;
};

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const { next = "/admin", error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form
        action={login}
        className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-6 text-center">
          <div className="text-xl font-semibold">{BRAND.name} 管理后台</div>
          <div className="mt-1 text-xs text-neutral-500">Phase 2 · admin CMS</div>
        </div>

        <input type="hidden" name="next" value={next} />

        <label className="mb-2 block text-sm text-neutral-700">管理员密码</label>
        <input
          type="password"
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-black focus:outline-none"
        />

        {error && (
          <div className="mt-3 text-sm text-red-600">
            {error === "bad" ? "密码错误" : "服务器配置缺失"}
          </div>
        )}

        <button
          type="submit"
          className="mt-5 w-full rounded-md bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800"
        >
          登录
        </button>

        <div className="mt-4 text-center text-xs text-neutral-400">
          会话保留 7 天 · httpOnly cookie
        </div>
      </form>
    </main>
  );
}
