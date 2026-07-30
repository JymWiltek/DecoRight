"use client";

import { useRef, type ReactNode } from "react";

/**
 * PB-B (#18 leftover) — press-and-drag horizontal scroll for the admin product
 * table on desktop. Native trackpad/scrollbar scrolling still works; this adds
 * grab-drag with the mouse. A drag that STARTS on an interactive element
 * (checkbox, inline-edit button/input, link) is left alone, so cell
 * click/edit/select is never hijacked. Touch is untouched — pointer events with
 * pointerType 'touch' are ignored, so the phone keeps its native swipe.
 */
export default function TableScroll({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ startX: 0, startLeft: 0, active: false, moved: false });

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "touch") return; // phone keeps native swipe
    if (e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (
      t.closest(
        "input,textarea,select,button,a,label,[contenteditable='true'],[role='button']",
      )
    ) {
      return; // let the cell handle its own click/edit/select
    }
    const el = ref.current;
    if (!el) return;
    drag.current = {
      startX: e.clientX,
      startLeft: el.scrollLeft,
      active: true,
      moved: false,
    };
    // Capture the pointer so moves keep firing on this div even as the cursor
    // travels over child cells during the drag.
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // ignore — capture is a best-effort nicety
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d.active) return;
    const el = ref.current;
    if (!el) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 3) {
      d.moved = true;
      el.style.userSelect = "none";
      el.style.cursor = "grabbing";
    }
    if (d.moved) {
      el.scrollLeft = d.startLeft - dx;
      e.preventDefault();
    }
  }

  function end() {
    const el = ref.current;
    if (el) {
      el.style.userSelect = "";
      el.style.cursor = "";
    }
    drag.current.active = false;
  }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerLeave={end}
      className="overflow-x-auto rounded-lg border border-neutral-200 bg-white"
    >
      {children}
    </div>
  );
}
