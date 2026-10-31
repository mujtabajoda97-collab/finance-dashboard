import type { Currency, ExchangeRate, RateMap } from './types';

/** Build a lookup of "1 AED = X target" from the exchange_rates rows. */
export function toRateMap(rows: ExchangeRate[]): RateMap {
  const map: RateMap = { AED: 1 };
  for (const r of rows) {
    const rate = Number(r.rate);
    if (r.base_currency === 'AED') map[r.target_currency] = rate;
    else if (r.target_currency === 'AED' && rate > 0) map[r.base_currency] = 1 / rate;
  }
  return map;
}

/** Convert any supported amount to AED. Returns null when the rate is unknown. */
export function toAED(amount: number, from: Currency, rates: RateMap): number | null {
  if (from === 'AED') return amount;
  const r = rates[from];
  return r && r > 0 ? amount / r : null;
}

/** Convert an AED amount into another currency. Returns null when the rate is unknown. */
export function fromAED(amountAED: number, to: Currency, rates: RateMap): number | null {
  if (to === 'AED') return amountAED;
  const r = rates[to];
  return r && r > 0 ? amountAED * r : null;
}

export function convert(amount: number, from: Currency, to: Currency, rates: RateMap): number | null {
  const aed = toAED(amount, from, rates);
  return aed === null ? null : fromAED(aed, to, rates);
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Parse user input that may contain thousands separators or Arabic-Indic digits. */
export function parseAmount(input: string): number {
  const normalized = input
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫]/g, '.')
    .replace(/[,٬\s]/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

export function formatMoney(amount: number, currency: Currency, lang: 'ar' | 'en', digits = 2): string {
  const n = new Intl.NumberFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount);
  return `${n} ${currency}`;
}

export function formatNumber(amount: number, lang: 'ar' | 'en', digits = 2): string {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE', {
    maximumFractionDigits: digits,
  }).format(amount);
}
