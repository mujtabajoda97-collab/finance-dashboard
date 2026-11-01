import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabel, donutSlices, spendingBreakdown, spendKey, spendRange } from '../src/lib/spending.ts';

const wallets = [{ id: 'a', currency: 'AED' as const }, { id: 's', currency: 'SDG' as const }];
const rates = { AED: 1, SDG: 160 };
const T = (wallet_id: string, type: 'EXPENSE' | 'INCOME' | 'TRANSFER', category: string | null, amount: number) => ({ wallet_id, type, category, amount });

test('only expenses and Sudan transfers count as spending', () => {
  assert.equal(spendKey({ type: 'EXPENSE', category: 'RENT' }), 'RENT');
  assert.equal(spendKey({ type: 'EXPENSE', category: null }), 'GENERAL');
  assert.equal(spendKey({ type: 'TRANSFER', category: 'SUDAN_TRANSFER' }), 'SUDAN_TRANSFER');
  assert.equal(spendKey({ type: 'TRANSFER', category: null }), null);
  assert.equal(spendKey({ type: 'INCOME', category: 'SALARY' }), null);
});

test('breakdown sums per category in AED, converts SDG, sorts desc, percentages add up to 100', () => {
  const b = spendingBreakdown([
    T('a', 'EXPENSE', 'RENT', 3000), T('a', 'EXPENSE', 'FOOD', 500), T('a', 'EXPENSE', 'FOOD', 500),
    T('s', 'EXPENSE', 'FOOD', 16000), // 100 AED
    T('a', 'INCOME', 'SALARY', 9999), T('a', 'TRANSFER', null, 700),
  ], wallets, rates);
  assert.deepEqual(b.rows.map((r) => [r.key, r.aed, r.n]), [['RENT', 3000, 1], ['FOOD', 1100, 3]]);
  assert.equal(b.total, 4100);
  assert.ok(Math.abs(b.rows.reduce((s, r) => s + r.pct, 0) - 100) < 1e-9);
  assert.equal(b.partial, false);
});

test('missing rate or wallet marks the result partial and skips the row', () => {
  const b = spendingBreakdown([T('s', 'EXPENSE', 'FOOD', 100), T('zzz', 'EXPENSE', 'FOOD', 50), T('a', 'EXPENSE', 'FOOD', 10)], wallets, { AED: 1 });
  assert.equal(b.total, 10);
  assert.equal(b.partial, true);
});

test('donut merges the smallest categories into OTHER and keeps the total', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ key: `C${i}`, aed: 100 - i, pct: 10, n: 1 }));
  const s = donutSlices(rows, 7);
  assert.equal(s.length, 7);
  assert.equal(s[6].key, 'OTHER');
  assert.equal(s[6].aed, 94 + 93 + 92 + 91);
  assert.equal(s.reduce((x, r) => x + r.aed, 0), rows.reduce((x, r) => x + r.aed, 0));
  assert.equal(donutSlices(rows.slice(0, 5), 7).length, 5);
});

test('ranges use Dubai month boundaries', () => {
  const now = new Date('2026-11-01T10:00:00Z'); // 14:00 Dubai, 1 Nov
  const cur = spendRange('current', now);
  assert.equal(cur.from.toISOString(), '2026-10-31T20:00:00.000Z'); // 1 Nov 00:00 Dubai
  assert.equal(cur.to.toISOString(), '2026-11-30T20:00:00.000Z');
  assert.equal(spendRange('previous', now).from.toISOString(), '2026-09-30T20:00:00.000Z');
  assert.equal(spendRange('previous', now).to.toISOString(), cur.from.toISOString());
  assert.equal(spendRange('last3', now).from.toISOString(), '2026-08-31T20:00:00.000Z');
  assert.equal(spendRange('last3', now).to.toISOString(), cur.to.toISOString());
  // just before midnight Dubai on 31 Oct still belongs to October
  assert.equal(spendRange('current', new Date('2026-10-31T19:59:00Z')).from.toISOString(), '2026-09-30T20:00:00.000Z');
});

test('category labels: known, new, and custom', () => {
  assert.equal(categoryLabel('ar', 'RENT'), 'إيجار');
  assert.equal(categoryLabel('ar', 'GROCERIES'), 'مقاضي');
  assert.equal(categoryLabel('en', 'PERSONAL'), 'Personal obligations');
  assert.equal(categoryLabel('ar', 'OTHER'), 'أخرى');
  assert.equal(categoryLabel('ar', 'Custom thing'), 'Custom thing');
});
