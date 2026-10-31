import { toAED } from './currency';
import type { RateMap, Txn, Wallet } from './types';

export interface MonthSummary {
  income: number;
  expenses: number;
  sudan: number;
  net: number;
  count: number;
  /** True when some amounts could not be converted to AED (missing rate / wallet). */
  partial: boolean;
}

/**
 * Month totals in AED. Debt repayments are excluded (they settle a debt, they are not
 * income/expense). Sudan transfers are shown separately and still reduce the net.
 */
export function monthSummary(txns: Txn[], wallets: Wallet[], rates: RateMap): MonthSummary {
  const byId = new Map(wallets.map((w) => [w.id, w]));
  let income = 0;
  let expenses = 0;
  let sudan = 0;
  let count = 0;
  let partial = false;

  for (const t of txns) {
    if (t.category === 'DEBT') continue;
    const isSudan = t.type === 'TRANSFER' && t.category === 'SUDAN_TRANSFER';
    if (t.type === 'TRANSFER' && !isSudan) continue; // internal transfers do not change net worth
    count += 1;
    const wallet = byId.get(t.wallet_id);
    const aed = wallet ? toAED(t.amount, wallet.currency, rates) : null;
    if (aed === null) {
      partial = true;
      continue;
    }
    if (t.type === 'INCOME') income += aed;
    else if (isSudan) sudan += aed;
    else expenses += aed;
  }
  return { income, expenses, sudan, net: income - expenses - sudan, count, partial };
}

/** One row of the month_summary() RPC (migration 0003): totals per type / category / wallet currency. */
export interface SummaryBucket {
  txn_type: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  category: string | null;
  currency: Wallet['currency'];
  total: number | string;
  n: number | string;
}

/**
 * Same rules as monthSummary(), applied to the database's pre-aggregated buckets, so totals stay exact
 * beyond the row-paging cap: DEBT repayments excluded, internal transfers skipped, Sudan transfers separate.
 */
export function summaryFromBuckets(buckets: SummaryBucket[], rates: RateMap): MonthSummary {
  let income = 0;
  let expenses = 0;
  let sudan = 0;
  let count = 0;
  let partial = false;
  for (const b of buckets) {
    if (b.category === 'DEBT') continue;
    const isSudan = b.txn_type === 'TRANSFER' && b.category === 'SUDAN_TRANSFER';
    if (b.txn_type === 'TRANSFER' && !isSudan) continue;
    count += Number(b.n);
    const aed = toAED(Number(b.total), b.currency, rates);
    if (aed === null) {
      partial = true;
      continue;
    }
    if (b.txn_type === 'INCOME') income += aed;
    else if (isSudan) sudan += aed;
    else expenses += aed;
  }
  return { income, expenses, sudan, net: income - expenses - sudan, count, partial };
}
