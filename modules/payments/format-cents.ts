/**
 * The one way to print whole cents as US dollars. Pure and client-safe: no
 * server or database imports, so components and modules share it.
 *
 * Default: Intl output, "$1,234.56" and "-$5.00" (and "-$0.00" for -0).
 * `grouping: false`: the plain form used by cancellation and asset-return
 * text, "$1234.56", "-$5.00" and "$0.00" for -0. It keeps the original
 * expression so its output stays byte-identical.
 * `wholeDollars`: Intl output rounded to whole dollars, "$1,235" (the overview and admin tiles).
 */
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatCents(cents: number, options: { grouping?: boolean; wholeDollars?: boolean } = {}) {
  if (options.wholeDollars) return usdWhole.format(cents / 100);
  if (options.grouping === false) {
    const sign = cents < 0 ? "-" : "";
    return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
  }
  return usd.format(cents / 100);
}

/** `formatCents(cents, { grouping: false })`, for callers that print the plain form. */
export function formatCentsPlain(cents: number) {
  return formatCents(cents, { grouping: false });
}
