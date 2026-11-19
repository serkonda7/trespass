/** German byte display for the export page's estimate and progress. */
const mb = new Intl.NumberFormat("de-DE", {
  style: "unit",
  unit: "megabyte",
  maximumFractionDigits: 1,
});
const kb = new Intl.NumberFormat("de-DE", {
  style: "unit",
  unit: "kilobyte",
  maximumFractionDigits: 0,
});

export function formatBytes(n: number): string {
  return n >= 1_000_000 ? mb.format(n / 1_000_000) : kb.format(Math.max(1, Math.round(n / 1000)));
}
