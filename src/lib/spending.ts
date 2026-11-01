import { toAED, round2 } from './currency';
import { dictionaries, type Lang } from './i18n';
import { startOfMonthDubai } from './time';
import type { RateMap, Txn, Wallet } from './types';

/** The three report windows: this Dubai month, the previous one, or the last three months including this one. */
export type SpendRange = 'current' | 'previous' | 'last3';
export const SPEND_RANGES: SpendRange[] = ['current', 'previous', 'last3'];

export function spendRange(kind: SpendRange, now: Date = new Date()): { from: Date; to: Date } {
  if (kind === 'current') return { from: startOfMonthDubai(now, 0), to: startOfMonthDubai(now, 1) };
  if (kind === 'previous') return { from: startOfMonthDubai(now, -1), to: startOfMonthDubai(now, 0) };
  return { from: startOfMonthDubai(now, -2), to: startOfMonthDubai(now, 1) };
}

export interface SpendRow {
  /** Category code (GENERAL, FOOD, RENT, PROJECT, DEBT, SUDAN_TRANSFER ...) or OTHER for the merged tail. */
  key: string;
  /** Amount in AED. */
  aed: number;
  /** 0..100 share of the total. */
  pct: number;
  /** How many transactions fell in this category. */
  n: number;
}

export interface SpendBreakdown {
  rows: SpendRow[];
  total: number;
  /** True when some transactions could not be converted to AED (missing rate / wallet) and were skipped. */
  partial: boolean;
}

type TxnLite = Pick<Txn, 'wallet_id' | 'type' | 'category' | 'amount'>;
type WalletLite = Pick<Wallet, 'id' | 'currency'>;

/** Spending categories: every expense by its category, plus Sudan transfers. Income and internal transfers are not spending. */
export function spendKey(t: Pick<Txn, 'type' | 'category'>): string | null {
  if (t.type === 'EXPENSE') return t.category && t.category.trim() ? t.category : 'GENERAL';
  if (t.type === 'TRANSFER' && t.category === 'SUDAN_TRANSFER') return 'SUDAN_TRANSFER';
  return null;
}

/** Spending per category in AED, largest first. */
export function spendingBreakdown(txns: TxnLite[], wallets: WalletLite[], rates: RateMap): SpendBreakdown {
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const sums = new Map<string, { aed: number; n: number }>();
  let partial = false;
  let total = 0;
  for (const t of txns) {
    const key = spendKey(t);
    if (key === null) continue;
    const w = byId.get(t.wallet_id);
    const aed = w ? toAED(Number(t.amount), w.currency, rates) : null;
    if (aed === null) { partial = true; continue; }
    const cur = sums.get(key) ?? { aed: 0, n: 0 };
    cur.aed += aed;
    cur.n += 1;
    sums.set(key, cur);
    total += aed;
  }
  const rows: SpendRow[] = [...sums]
    .map(([key, v]) => ({ key, aed: round2(v.aed), n: v.n, pct: total > 0 ? (v.aed / total) * 100 : 0 }))
    .sort((a, b) => b.aed - a.aed || a.key.localeCompare(b.key));
  return { rows, total: round2(total), partial };
}

/** At most `max` slices for the donut: the smallest categories are merged into one OTHER slice. */
export function donutSlices(rows: SpendRow[], max = 7): SpendRow[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max - 1);
  const tail = rows.slice(max - 1);
  return [...head, {
    key: 'OTHER',
    aed: round2(tail.reduce((s, r) => s + r.aed, 0)),
    pct: tail.reduce((s, r) => s + r.pct, 0),
    n: tail.reduce((s, r) => s + r.n, 0),
  }];
}

/** Display name of a category in the chosen language; unknown (custom) categories show as typed. */
export function categoryLabel(lang: Lang, key: string): string {
  if (key === 'OTHER') return lang === 'ar' ? 'أخرى' : 'Other';
  const dict = dictionaries[lang] as Record<string, string>;
  return dict[`cat_${key}`] ?? key;
}
