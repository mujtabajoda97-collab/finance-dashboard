// Same rules as src/lib/stats.ts summaryFromBuckets (DEBT excluded, internal transfers skipped, Sudan separate).
export function summaryFromBuckets(buckets, rates) {
  const toAED = (amt, cur) => (cur === 'AED' ? amt : rates[cur] > 0 ? amt / rates[cur] : null);
  let income = 0, expenses = 0, sudan = 0, count = 0, partial = false;
  for (const b of buckets) {
    if (b.category === 'DEBT') continue;
    const isSudan = b.txn_type === 'TRANSFER' && b.category === 'SUDAN_TRANSFER';
    if (b.txn_type === 'TRANSFER' && !isSudan) continue;
    count += Number(b.n);
    const aed = toAED(Number(b.total), b.currency);
    if (aed === null) { partial = true; continue; }
    if (b.txn_type === 'INCOME') income += aed; else if (isSudan) sudan += aed; else expenses += aed;
  }
  return { income, expenses, sudan, net: income - expenses - sudan, count, partial };
}
