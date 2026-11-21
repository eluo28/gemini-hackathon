export function formatMoney(amount: number, currency: string) {
  try {
    const format = new Intl.NumberFormat(undefined, { style: 'currency', currency });
    return format.format(amount / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
  } catch { return `${amount} ${currency} (minor units)`; }
}
