"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { setLocale } from "@/app/actions/locale";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";

type Props = {
  /** The locale resolved for the current render (cookie / header). */
  current: Locale;
};

/**
 * Plain <select> in the top nav. Calls the setLocale server action,
 * which writes the cookie and revalidates "/". We also call
 * router.refresh() so the current route's RSC payload re-fetches
 * immediately — otherwise the user sees the old locale until the
 * next navigation.
 *
 * We avoid a fancy dropdown here on purpose: the native <select> is
 * accessible, works without JS (yes, it submits via onChange which
 * requires JS, but the page remains usable with the old locale) and
 * matches how every existing header on the site is styled.
 */
export default function LanguageSwitcher({ current }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const tLanguage = useTranslations("language");

  return (
    <label className="flex items-center gap-1.5 text-xs text-neutral-500">
      <span aria-hidden="true">🌐</span>
      <select
        aria-label={tLanguage("label")}
        value={current}
        disabled={pending}
        onChange={(e) => {
          const next = e.currentTarget.value as Locale;
          startTransition(async () => {
            await setLocale(next);
            router.refresh();
          });
        }}
        className="cursor-pointer rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 focus:border-black focus:outline-none disabled:opacity-50"
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABELS[l].native}
          </option>
        ))}
      </select>
    </label>
  );
}
