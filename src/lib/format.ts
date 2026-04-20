const MYR = new Intl.NumberFormat("en-MY", {
  style: "currency",
  currency: "MYR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatMYR(value: number | null | undefined): string {
  if (value == null) return "—";
  return MYR.format(value);
}
