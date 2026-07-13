"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  consumerEmailAuth,
  type ConsumerAuthState,
} from "@/app/auth/actions";

type Props = {
  open: boolean;
  onClose: () => void;
  /** Same-origin path to return to after the Google round-trip, and the
   *  scope router.refresh() re-renders after the email path succeeds. */
  next: string;
};

const INITIAL: ConsumerAuthState = { ok: false };

/**
 * Feature 6 — the AR login gate. Opened when a logged-out visitor taps
 * "在 AR 中查看". Two ways in, both free (AR stays free; the point is to
 * capture the email for marketing):
 *   • Google  — supabase.auth.signInWithOAuth (needs the dashboard toggle;
 *               falls back to a friendly notice if the provider is off).
 *   • Email    — a combined sign-in / sign-up server action.
 * On success the sb-* session cookies are set and we router.refresh() so
 * the server re-renders the product page with AR unlocked.
 */
export default function ConsumerAuthModal({ open, onClose, next }: Props) {
  const t = useTranslations("authGate");
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    consumerEmailAuth,
    INITIAL,
  );
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleErr, setGoogleErr] = useState(false);

  useEffect(() => {
    if (state.ok) {
      router.refresh();
      onClose();
    }
    // Only react to a successful auth; onClose/router identities are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.ok]);

  if (!open) return null;

  const signInWithGoogle = async () => {
    setGoogleErr(false);
    setGoogleBusy(true);
    try {
      const supabase = createClient();
      const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(
        next,
      )}`;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (error) {
        setGoogleErr(true);
        setGoogleBusy(false);
      }
      // On success the browser navigates away to Google — no further UI.
    } catch {
      setGoogleErr(true);
      setGoogleBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-neutral-900">{t("title")}</h2>
        <p className="mt-1 text-sm text-neutral-500">{t("subtitle")}</p>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={googleBusy}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:opacity-60"
        >
          <GoogleGlyph />
          {t("google")}
        </button>
        {googleErr && (
          <p className="mt-1.5 text-xs text-amber-600">
            {t("googleUnavailable")}
          </p>
        )}

        <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-neutral-400">
          <span className="h-px flex-1 bg-neutral-200" />
          {t("or")}
          <span className="h-px flex-1 bg-neutral-200" />
        </div>

        <form action={formAction} className="flex flex-col gap-3">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder={t("email")}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-900"
          />
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="current-password"
            placeholder={t("password")}
            className="rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-900"
          />
          {state.error && (
            <p className="text-xs text-red-600">{t(`err_${state.error}`)}</p>
          )}
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:opacity-60"
          >
            {pending ? t("submitting") : t("submit")}
          </button>
        </form>

        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-xs text-neutral-400 hover:text-neutral-600"
        >
          {t("cancel")}
        </button>
        <p className="mt-3 text-[11px] leading-relaxed text-neutral-400">
          {t("privacy")}
        </p>
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
