// Integration: rows + month_summary() buckets produced by the REAL database triggers (throwaway sim DB, see
// supabase/tests/0003_ui_integration_seed.sql) fed to the app's own aggregation code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { monthSummary, summaryFromBuckets } from '../src/lib/stats.ts';

const fx = JSON.parse(readFileSync(new URL('./fixtures/ui_month.json', import.meta.url), 'utf8'));
const rates = { AED: 1, SDG: 160, USD: 0.27229 };
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.005, `${a} != ${b}`);

test('row-based monthSummary on DB-produced rows: hand-computed numbers', () => {
  const s = monthSummary(fx.txns, fx.wallets, rates);
  near(s.income, 5000);          // salary only; 200 AED debt collection excluded
  near(s.expenses, 310);         // 300 AED food + 1600 SDG / 160 = 10 AED; 583.63 AED debt repayments excluded
  near(s.sudan, 800);            // Sudan transfer shown separately
  near(s.net, 3890);             // 5000 - 310 - 800
  assert.equal(s.count, 4);      // salary, food, transport, Sudan
  assert.equal(s.partial, false);
});

test('RPC-bucket summary equals the row-based summary exactly', () => {
  const a = monthSummary(fx.txns, fx.wallets, rates);
  const b = summaryFromBuckets(fx.buckets, rates);
  for (const k of ['income', 'expenses', 'sudan', 'net'] as const) near(a[k], b[k]);
  assert.equal(a.count, b.count);
});

test('debt repayments never appear as ordinary income/expense', () => {
  const debt = fx.buckets.filter((b: any) => b.category === 'DEBT');
  assert.equal(debt.length, 2);   // the database does return them (so the app can show them separately)...
  const s = summaryFromBuckets(fx.buckets, rates);
  near(s.income, 5000);           // ...but 200.00 AED collected is not in income
  near(s.expenses, 310);          // ...and 400 + 183.63 repaid is not in expenses
  const naive = fx.buckets.reduce((acc: number, b: any) => acc + (b.txn_type === 'EXPENSE' ? Number(b.total) : 0), 0);
  assert.ok(naive > 310);         // sanity: counting them would have inflated expenses
});

test('internal transfers (same-currency and cross-currency) do not appear as income or expense', () => {
  const internal = fx.buckets.filter((b: any) => b.category === 'INTERNAL_TRANSFER');
  assert.equal(internal.length, 1);
  near(Number(internal[0].total), 567.25);   // 200 + 367.25 are in the DB buckets...
  const s = summaryFromBuckets(fx.buckets.filter((b: any) => b.category !== 'INTERNAL_TRANSFER'), rates);
  const all = summaryFromBuckets(fx.buckets, rates);
  near(all.expenses, s.expenses);            // ...and change nothing in the app's totals
  near(all.income, s.income);
  near(all.net, s.net);
});

test('Sudan transfers: reported separately, reduce net, not counted as expenses', () => {
  const s = summaryFromBuckets(fx.buckets, rates);
  near(s.sudan, 800);
  near(s.expenses, 310);
  near(s.net, s.income - s.expenses - s.sudan);
});

test('Dubai month boundaries: 30 Sep 23:59 and 1 Nov 00:00 are excluded', () => {
  const salary = fx.buckets.find((b: any) => b.category === 'SALARY');
  near(Number(salary.total), 5000);          // not 5777
  assert.equal(fx.buckets.some((b: any) => Number(b.total) === 999), false);
});

test('database state is consistent for the same dataset', () => {
  assert.equal(fx.drift, 0);
  const bal = Object.fromEntries(fx.wallets.map((w: any) => [w.name, Number(w.balance)]));
  near(bal.UA, 12727.12); near(bal.UA2, 200); near(bal.US, 98400); near(bal.UU, 100);
});

test('missing exchange rate marks the summary as partial instead of guessing', () => {
  const s = summaryFromBuckets(fx.buckets, { AED: 1 });
  assert.equal(s.partial, true);
  near(s.expenses, 300);
});
