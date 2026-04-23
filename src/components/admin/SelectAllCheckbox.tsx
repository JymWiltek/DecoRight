"use client";

/**
 * Header checkbox that toggles every per-row id checkbox in
 * <form id="bulk-form">. Stays in sync with manual row toggles via
 * a change listener on the form (sets indeterminate / checked).
 */

import { useEffect, useRef } from "react";

export default function SelectAllCheckbox() {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const formEl = document.getElementById("bulk-form") as HTMLFormElement | null;
    if (!formEl || !ref.current) return;
    function sync() {
      const boxes = formEl!.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"][name="ids"]',
      );
      const total = boxes.length;
      let checked = 0;
      for (const b of boxes) if (b.checked) checked += 1;
      const el = ref.current!;
      el.checked = total > 0 && checked === total;
      el.indeterminate = checked > 0 && checked < total;
    }
    formEl.addEventListener("change", sync);
    sync();
    return () => formEl.removeEventListener("change", sync);
  }, []);

  function toggleAll(e: React.ChangeEvent<HTMLInputElement>) {
    const formEl = document.getElementById("bulk-form") as HTMLFormElement | null;
    if (!formEl) return;
    const boxes = formEl.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"][name="ids"]',
    );
    for (const b of boxes) b.checked = e.target.checked;
    formEl.dispatchEvent(new Event("change", { bubbles: true }));
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      onChange={toggleAll}
      className="h-4 w-4 rounded border-neutral-300"
      aria-label="Select all rows"
    />
  );
}
