"use client";

/**
 * Wave 5 (mig 0038) — single toggle checkbox for an image's
 * show_on_storefront / is_primary_thumbnail / feed_to_ai flag.
 *
 * Why a separate file: ProductImagesSection is a Server Component
 * (it renders forms with server-action-bound `action={fn}` props).
 * The checkbox needs an `onChange` handler to auto-submit the parent
 * form when toggled — that's a client-side event handler. Splitting
 * just the checkbox into its own `"use client"` boundary keeps the
 * parent server-render path clean.
 *
 * The form lives in ProductImagesSection (server component); we
 * receive its id via the `formId` prop and use `requestSubmit()`
 * on the form element, which fires the server-action POST.
 */

type Props = {
  /** The id of the wrapping <form action={setImageToggle}> in
   *  ProductImagesSection. */
  formId: string;
  /** Current boolean state. The form's hidden "value" input is
   *  pre-baked to the OPPOSITE so submitting flips. */
  checked: boolean;
};

export default function ImageToggleCheckbox({ formId, checked }: Props) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => {
        const form = document.getElementById(formId);
        if (form instanceof HTMLFormElement) {
          form.requestSubmit();
        }
      }}
      className="mt-0.5"
    />
  );
}
