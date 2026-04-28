"use client";

/**
 * Free-text input that listens to the AI autofill bus.
 *
 * Wave 2A · Commit 8 added `name` + `description` to the GPT-4o
 * Vision schema. When AIInferButton dispatches `ai-autofill-apply`
 * with a string in either field, the matching input here picks it
 * up and overwrites its value — same channel the taxonomy pickers
 * already use.
 *
 * Why a controlled component instead of imperative `inputRef.value =`:
 *   - React's controlled inputs are the canonical pattern for "value
 *     can change from outside the keystroke handler". Setting `.value`
 *     directly works but doesn't re-render any sibling that reads
 *     defaultValue at mount, and the form-state libraries we might
 *     adopt later (RHF, formedible) all assume controlled ⇒ predictable.
 *   - User edits are still preserved: onChange writes through to local
 *     state; the next AI run only overwrites if `detail[fieldName]`
 *     is a non-empty string. Undefined / null leaves whatever the
 *     operator typed alone.
 *
 * Why the `name="…"` attribute drives FormData submission via the
 * outer <form id="product-form">: ProductForm is the same "external
 * inputs linked via form={…}" pattern as every other field. We just
 * mark this one as autofill-aware.
 */

import { useEffect, useState } from "react";
import {
  subscribeAutofillApply,
  type AutofillApplyDetail,
} from "@/lib/ai/autofill-bus";

type CommonProps = {
  /** id of the outer <form> these inputs submit with. Same FORM_ID
   *  ProductForm passes to every field. */
  form: string;
  name: "name" | "description";
  defaultValue?: string | null;
  required?: boolean;
  className?: string;
  placeholder?: string;
};

export function AutofillTextInput(props: CommonProps) {
  const [value, setValue] = useState(props.defaultValue ?? "");

  useEffect(
    () =>
      subscribeAutofillApply((detail: AutofillApplyDetail) => {
        const next = detail[props.name];
        // Undefined → AI didn't produce this field; leave whatever the
        // operator already has. Null/empty → same: don't blank out a
        // hand-typed name with the AI's "could not classify" sentinel.
        if (typeof next === "string" && next.length > 0) {
          setValue(next);
        }
      }),
    [props.name],
  );

  return (
    <input
      form={props.form}
      name={props.name}
      required={props.required}
      placeholder={props.placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className={props.className}
    />
  );
}

type TextareaProps = CommonProps & { rows?: number };

export function AutofillTextarea(props: TextareaProps) {
  const [value, setValue] = useState(props.defaultValue ?? "");

  useEffect(
    () =>
      subscribeAutofillApply((detail: AutofillApplyDetail) => {
        const next = detail[props.name];
        if (typeof next === "string" && next.length > 0) {
          setValue(next);
        }
      }),
    [props.name],
  );

  return (
    <textarea
      form={props.form}
      name={props.name}
      required={props.required}
      placeholder={props.placeholder}
      rows={props.rows}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      className={props.className}
    />
  );
}
