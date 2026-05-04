"use client";

/**
 * Wave UI · Commit 1 — reusable horizontal-snap rail.
 *
 * Used by:
 *   • home `/` Section 1: Item Type rail (commit 2)
 *   • `/room/[slug]`: Item-types-in-this-room rail (commit 4)
 *   • `/item/[slug]`: Sibling-item-types-in-same-room rail (commit 5)
 *
 * Why a shared component instead of inline `flex overflow-x-auto`:
 * iOS scroll-snap, scrollbar hiding, and edge-padding are easy to get
 * wrong individually and trivial to drift between three rails on three
 * pages. One component = one source of truth.
 *
 * Behavior matrix:
 *   • Touch (mobile)         — native scroll, snap-x mandatory.
 *   • Trackpad two-finger    — native horizontal scroll.
 *   • Mouse Shift+wheel      — native (browser remaps wheel→x).
 *   • Mouse click-drag       — handled here via PointerEvents (the
 *                              one path that has no native fallback
 *                              on desktop). Mouse-only branch — touch
 *                              and pen still use the native path so
 *                              we don't fight the OS scroller.
 *
 * Mobile-first CSS:
 *   • `snap-x snap-mandatory` — items lock into place (IKEA-style).
 *   • `snap-start` on each child — leftmost edge aligns with the
 *     viewport-left of the rail.
 *   • `pl-4 pr-4` (matches outer page padding) so the first card has
 *     a left gutter equal to the page edge — feels native.
 *   • `[scrollbar-width:none]` + `[&::-webkit-scrollbar]:hidden` —
 *     desktop browsers don't render a horizontal scrollbar that
 *     would feel out of place on a mobile design.
 *   • `cursor-grab` / `cursor-grabbing` — visual affordance so mouse
 *     users know the rail is draggable; only relevant on desktop.
 *   • `select-none` on the <ul> — without it, a mouse-drag through
 *     card labels triggers text selection mid-drag, which both
 *     fights the scroll and looks janky. Cards are tiles, not prose,
 *     so suppressing selection inside the rail has no real cost.
 *
 * Fixed-width children:
 *   The rail does NOT enforce child widths. Callers set their own
 *   (`w-32`, `w-44`, `w-1/2`) since item-type tiles and room tiles
 *   want different widths. The rail just provides scroll behavior +
 *   gutters + snap.
 *
 * "use client" — was a Server Component originally (pure CSS, no JS).
 * Click-drag forces a transition to client. The cost is one extra
 * tiny bundle entry; the component holds no state across renders
 * beyond a useRef so hydration is trivial. None of the rail's
 * children become client components — they're still passed in as
 * already-rendered RSC output.
 */

import { useRef } from "react";

type Props = {
  /** Each child should be a fixed-width card. The rail wraps them in
   *  snap-start scroll children. */
  children: React.ReactNode;
  /** Extra Tailwind classes for the outer wrapper (e.g. `mt-4`). */
  className?: string;
  /** Aria label for assistive tech — describe what the rail contains
   *  ("Item types"). Falls back to `region` semantics. */
  ariaLabel?: string;
};

/** Distinguishing a click from a drag: total movement < this many
 *  CSS pixels = click (let the link fire); ≥ this = drag (swallow the
 *  click so the user doesn't navigate after they reposition the rail).
 *  8px is what Material Design tap-target jitter and the CSS
 *  drag-and-drop spec settle on — 5px (our previous setting) was
 *  routinely tripped by a real human pressing the mouse button down
 *  on a trackpad, where the finger naturally translates 2–6px during
 *  the press. The result was every Browse-by-item card click being
 *  classified as a drag and the navigation getting suppressed.
 *  8px keeps deliberate short-drag-then-release feeling responsive
 *  while ignoring the press wobble.  */
const CLICK_DRAG_THRESHOLD_PX = 8;

export default function HScrollRail({
  children,
  className = "",
  ariaLabel,
}: Props) {
  const ulRef = useRef<HTMLUListElement>(null);
  /** Active drag bookkeeping. Lives in a ref (not state) — re-rendering
   *  on every pointermove would be wasteful and would also reset
   *  scrollLeft we just programmatically set. We DO want one reactive
   *  signal: the cursor swap, which we do by toggling a class directly
   *  on the <ul> instead of round-tripping through React state. */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    /** Has movement crossed CLICK_DRAG_THRESHOLD_PX yet? Once true,
     *  the click after pointerup will be swallowed. We keep this on
     *  the ref so the click handler (which fires AFTER pointerup)
     *  can read it. Cleared in the click capture handler. */
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLUListElement>) => {
    // Mouse only. Touch and pen keep the native scroller — that path
    // is already smooth on iOS/Android and intercepting it would only
    // introduce bugs (e.g. fighting iOS's elastic over-scroll).
    if (e.pointerType !== "mouse") return;
    // Don't hijack form-control interactions. Rails don't currently
    // host inputs, but if a future caller drops a search field in,
    // dragging through it must not steal focus or text selection.
    // <a> and <button> are deliberately NOT in this list — the rail
    // cards ARE links, so we MUST allow drag from a link; the click
    // suppression below keeps the navigation correct.
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select")) return;
    const ul = ulRef.current;
    if (!ul) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startScrollLeft: ul.scrollLeft,
      moved: false,
    };
    // NOTE: We do NOT call setPointerCapture here. The previous
    // implementation captured eagerly so off-rail drags would still
    // track, but eager capture has a cost: in Chrome, the click event
    // is composed against the captured target, NOT the underlying
    // <a>. Result — every card "click" was getting redirected to the
    // <ul>, and the link's default navigation never ran. Card clicks
    // appeared dead in production.
    //
    // Lazy capture: we only capture once movement exceeds the
    // threshold (i.e. we've confirmed it's a drag). For pure clicks
    // — the common case — capture is never set, the click event
    // dispatches normally to the <a>, and the link navigates. Drags
    // pay one delayed call to setPointerCapture but visually feel
    // identical (the cursor is already moving by then).
    ul.classList.add("cursor-grabbing");
    ul.classList.remove("cursor-grab");
  };

  const onPointerMove = (e: React.PointerEvent<HTMLUListElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const ul = ulRef.current;
    if (!ul) return;
    const dx = e.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) >= CLICK_DRAG_THRESHOLD_PX) {
      drag.moved = true;
      // Lazy capture (see onPointerDown rationale): now that we've
      // confirmed a real drag, take pointer capture so off-rail
      // pointermove still feeds us scroll deltas. setPointerCapture
      // can throw if the pointer is already gone (rare; e.g. user
      // alt-tabs mid-drag) — falling through still works, we just
      // lose off-rail tracking for this gesture.
      try {
        ul.setPointerCapture(e.pointerId);
      } catch {
        // pointer already released — ignore
      }
    }
    // Inverted: dragging right reveals more of the right side, which
    // means scrollLeft DECREASES. dx > 0 (cursor moved right) →
    // scrollLeft -= dx. Same direction convention as native trackpad.
    //
    // GUARD: only mutate scrollLeft AFTER the threshold has been
    // crossed. Real mouse clicks emit a 1–3px pointermove between
    // mousedown and mouseup (hand jitter on a trackpad / a CDP click
    // that synthesises a brief move). With `snap-x mandatory` CSS
    // applied to the rail, ANY scrollLeft write triggers a scroll-
    // snap re-align — even a 1-pixel shift will cause the rail to
    // visually jump back to the nearest snap point. That re-align
    // happens BETWEEN mousedown and click, so the click event is
    // composed against whatever element ends up under the FINAL
    // cursor position (often the gap between cards or the <ul>
    // itself), and the underlying <a>'s default navigation never
    // runs. Symptom: card gets focus ring (mousedown landed) but
    // URL doesn't change.
    //
    // Holding scrollLeft steady below the threshold means a click
    // is genuinely a click — no scroll, no snap, click dispatches
    // against the same element the mousedown hit.
    if (drag.moved) {
      ul.scrollLeft = drag.startScrollLeft - dx;
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLUListElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const ul = ulRef.current;
    if (ul) {
      // Capture only exists if we crossed the drag threshold during
      // pointermove (lazy capture — see onPointerDown). Calling
      // releasePointerCapture without a matching setPointerCapture
      // throws InvalidStateError, so we guard on `drag.moved`.
      if (drag.moved) {
        try {
          ul.releasePointerCapture(e.pointerId);
        } catch {
          // Already released (e.g. pointercancel after capture lost) —
          // safe to ignore; either way the drag ends here.
        }
      }
      ul.classList.remove("cursor-grabbing");
      ul.classList.add("cursor-grab");
    }
    // Don't clear dragRef yet if we moved — the upcoming click event
    // (browsers fire click AFTER pointerup on the originating target)
    // needs to read `drag.moved` to decide whether to suppress
    // navigation. The click capture handler clears the ref. If we
    // didn't move, no click suppression is needed and we can clear
    // immediately so a stale ref doesn't leak.
    if (!drag.moved) dragRef.current = null;
  };

  const onClickCapture = (e: React.MouseEvent<HTMLUListElement>) => {
    // Capture phase so we run BEFORE the link's own click handler
    // (Next.js Link intercepts in bubble). preventDefault here stops
    // the navigation; stopPropagation keeps Next's listener silent.
    const drag = dragRef.current;
    if (drag?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    dragRef.current = null;
  };

  return (
    <div
      // -mx-4 cancels the parent's px-4 so the rail can bleed to the
      // viewport edges; we re-add the gutter via px-4 below. This is
      // the standard "edge-to-edge horizontal scroller in a padded
      // container" pattern and lets the last card scroll all the way
      // off-screen instead of stopping at the page padding.
      className={`-mx-4 ${className}`}
      role="region"
      aria-label={ariaLabel}
    >
      <ul
        ref={ulRef}
        className="
          flex snap-x snap-mandatory gap-3 overflow-x-auto
          px-4 pb-2
          [scrollbar-width:none]
          [&::-webkit-scrollbar]:hidden
          cursor-grab select-none
        "
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {/* Caller passes <li> children OR plain elements. To stay
         *  flexible (and keep the shared component dumb), we don't
         *  auto-wrap — callers always emit <li> directly. The eslint
         *  rule that complains about non-li children in <ul> stays
         *  honest because every rail user passes <li>. */}
        {children}
      </ul>
    </div>
  );
}
