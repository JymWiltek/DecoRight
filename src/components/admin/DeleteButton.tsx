"use client";

import { useTransition } from "react";
import { deleteProduct } from "@/app/admin/(dashboard)/products/actions";

export default function DeleteButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`确定删除 "${name}"？此操作不可撤销。`)) return;
        startTransition(() => deleteProduct(id));
      }}
      className="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-600 hover:border-red-500 disabled:opacity-50"
    >
      {pending ? "删除中…" : "删除"}
    </button>
  );
}
