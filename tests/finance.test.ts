import test from 'node:test';
import assert from 'node:assert/strict';
import { balancesAfterChange, buildTxnRow, overdrawn, singleFlight, suggestToAmount, toCents, txnEffects, validateTransfer } from '../src/lib/finance.ts';
import { monthSummary } from '../src/lib/stats.ts';
import { debtStatus, paidFromPayments, remaining, suggestWalletAmount, validatePayment } from '../src/lib/debt.ts';
import { fromDubaiInput, startOfMonthDubai, toDubaiInput } from '../src/lib/time.ts';
import { fetchAllPages } from '../src/lib/paging.ts';
import type { Txn, Wallet } from '../src/lib/types.ts';

const W = (id: string, currency: Wallet['currency'], balance: number, extra: Partial<Wallet> = {}): Wallet => ({
  id, name: id, currency, opening_balance: 0, balance, min_balance_threshold: 0, is_archived: false, created_at: '', updated_at: '', ...extra,
});
const T = (p: Partial<Txn> & Pick<Txn, 'type' | 'wallet_id' | 'amount'>): Txn => ({
  id: Math.random().toString(), to_wallet_id: null, category: null, original_amount: null, original_currency: null,
  exchange_rate_used: null, notes: null, date: '2026-10-10T08:00:00Z', debt_payment_id: null, ...p,
});
const rates = { AED: 1, SDG: 160, USD: 0.27229 };

test('transfer effects: debit and credit are always paired and conserve value', () => {
  const e = txnEffects({ type: 'TRANSFER', wallet_id: 'a', to_wallet_id: 'b', amount: 200 });
  assert.equal(e.get('a'), -20000);
  assert.equal(e.get('b'), 20000);
  assert.equal([...e.values()].reduce((s, v) => s + v, 0), 0);
  const x = txnEffects({ type: 'TRANSFER', wallet_id: 'a', to_wallet_id: 'b', amount: 100, to_amount: 6000 });
  assert.equal(x.get('a'), -10000);
  assert.equal(x.get('b'), 600000);
});

test('edit / delete rebalance exactly like the database trigger', () => {
  const ws = [W('a', 'AED', 1000), W('b', 'AED', 200)];
  const old = { type: 'TRANSFER' as const, wallet_id: 'a', to_wallet_id: 'b', amount: 200 };
  // editing 200 -> 300 : a 1000-100, b 200+100
  const edited = balancesAfterChange(ws, old, { ...old, amount: 300 });
  assert.equal(edited.get('a'), 90000);
  assert.equal(edited.get('b'), 30000);
  // deleting restores the pre-transfer world (a +200, b -200)
  const deleted = balancesAfterChange(ws, old, null);
  assert.equal(deleted.get('a'), 120000);
  assert.equal(deleted.get('b'), 0);
  // changing the type expense -> income
  const e = { type: 'EXPENSE' as const, wallet_id: 'a', amount: 50 };
  assert.equal(balancesAfterChange(ws, e, { ...e, type: 'INCOME' }).get('a'), 110000);
  // moving to another wallet
  assert.deepEqual([...balancesAfterChange(ws, e, { ...e, wallet_id: 'b' })], [['a', 105000], ['b', 15000]]);
});

test('overdraft detection only flags wallets pushed below zero', () => {
  const ws = [W('a', 'AED', 100), W('b', 'AED', -5)];
  assert.deepEqual(overdrawn(ws, null, { type: 'EXPENSE', wallet_id: 'a', amount: 150 }), ['a']);
  assert.deepEqual(overdrawn(ws, null, { type: 'EXPENSE', wallet_id: 'a', amount: 100 }), []);
  assert.deepEqual(overdrawn(ws, null, { type: 'EXPENSE', wallet_id: 'b', amount: 10 }), []); // already negative
  assert.deepEqual(overdrawn(ws, { type: 'INCOME', wallet_id: 'a', amount: 80 }, null), ['a'].filter(() => false)); // 100-80=20 ok
});

test('float noise never leaks into cents', () => {
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(1.005), 101);
  const ws = [W('a', 'AED', 0.3)];
  assert.equal(balancesAfterChange(ws, null, { type: 'EXPENSE', wallet_id: 'a', amount: 0.1 + 0.2 }).get('a'), 0);
});

test('validateTransfer', () => {
  const a = W('a', 'AED', 1), b = W('b', 'AED', 1), s = W('s', 'SDG', 1), z = W('z', 'AED', 1, { is_archived: true });
  assert.equal(validateTransfer({ from: a, to: b, amount: 10, toAmount: null }), null);
  assert.equal(validateTransfer({ from: a, to: a, amount: 10, toAmount: null }), 'sameWallet');
  assert.equal(validateTransfer({ from: a, to: b, amount: 0, toAmount: null }), 'amount');
  assert.equal(validateTransfer({ from: a, to: b, amount: NaN, toAmount: null }), 'amount');
  assert.equal(validateTransfer({ from: a, to: z, amount: 5, toAmount: null }), 'archived');
  assert.equal(validateTransfer({ from: a, to: s, amount: 5, toAmount: null }), 'toAmount');
  assert.equal(validateTransfer({ from: a, to: s, amount: 5, toAmount: 0 }), 'toAmount');
  assert.equal(validateTransfer({ from: a, to: s, amount: 5, toAmount: 800 }), null);
});

test('buildTxnRow: transfer shape, to_amount only across currencies, idempotency key optional', () => {
  const base = { type: 'TRANSFER' as const, walletId: 'a', toWalletId: 'b', amount: 10, category: null, notes: ' x ', dateISO: '2026-10-10T00:00:00.000Z' };
  const same = buildTxnRow({ ...base, fromCurrency: 'AED', toCurrency: 'AED', toAmount: 10 });
  assert.equal(same.to_amount, null);
  assert.equal(same.category, 'INTERNAL_TRANSFER');
  assert.equal(same.notes, 'x');
  assert.ok(!('client_request_id' in same));
  const cross = buildTxnRow({ ...base, fromCurrency: 'AED', toCurrency: 'SDG', toAmount: 1600, requestId: 'r1' });
  assert.equal(cross.to_amount, 1600);
  assert.equal(cross.client_request_id, 'r1');
  const exp = buildTxnRow({ type: 'EXPENSE', walletId: 'a', toWalletId: 'b', amount: 5, category: 'FOOD', notes: '', dateISO: 'd' });
  assert.equal(exp.to_wallet_id, null);
  assert.equal(exp.category, 'FOOD');
});

test('suggestToAmount uses stored rates', () => {
  assert.equal(suggestToAmount(10, 'AED', 'SDG', rates), 1600);
  assert.equal(suggestToAmount(10, 'AED', 'AED', rates), 10);
  assert.equal(suggestToAmount(10, 'AED', 'SDG', { AED: 1 }), null);
});

test('singleFlight: a double tap posts once', async () => {
  const run = singleFlight();
  let posts = 0;
  const post = async () => { await new Promise((r) => setTimeout(r, 10)); posts++; };
  await Promise.all([run(post), run(post), run(post)]);
  assert.equal(posts, 1);
  await run(post); // usable again afterwards
  assert.equal(posts, 2);
});

test('monthSummary: debt repayments and internal transfers are not income/expense', () => {
  const ws = [W('a', 'AED', 0), W('s', 'SDG', 0)];
  const txns = [
    T({ type: 'INCOME', wallet_id: 'a', amount: 1000, category: 'SALARY' }),
    T({ type: 'EXPENSE', wallet_id: 'a', amount: 200, category: 'FOOD' }),
    T({ type: 'EXPENSE', wallet_id: 'a', amount: 300, category: 'DEBT', debt_payment_id: 'p1' }), // I repaid
    T({ type: 'INCOME', wallet_id: 'a', amount: 500, category: 'DEBT', debt_payment_id: 'p2' }), // I was repaid
    T({ type: 'TRANSFER', wallet_id: 'a', to_wallet_id: 's', amount: 100, to_amount: 16000, category: 'INTERNAL_TRANSFER' }),
    T({ type: 'TRANSFER', wallet_id: 'a', amount: 160, category: 'SUDAN_TRANSFER' }),
    T({ type: 'EXPENSE', wallet_id: 's', amount: 1600, category: 'FOOD' }), // 10 AED
  ];
  const m = monthSummary(txns, ws, rates);
  assert.equal(m.income, 1000);
  assert.equal(m.expenses, 210);
  assert.equal(m.sudan, 160);
  assert.equal(m.net, 1000 - 210 - 160);
  assert.equal(m.partial, false);
  assert.equal(monthSummary(txns, ws, { AED: 1 }).partial, true); // missing SDG rate is flagged, not guessed
});

test('debt: partial repayments, status and limits', () => {
  assert.equal(debtStatus(1000, 0), 'OPEN');
  assert.equal(debtStatus(1000, 300), 'PARTIAL');
  assert.equal(debtStatus(1000, 999.99), 'PARTIAL');
  assert.equal(debtStatus(1000, 1000), 'PAID');
  assert.equal(remaining(1000, 300.1), 699.9);
  assert.equal(validatePayment(1000, 300, 700), null);
  assert.equal(validatePayment(1000, 300, 700.01), 'exceeds');
  assert.equal(validatePayment(1000, 1000, 1), 'settled');
  assert.equal(validatePayment(1000, 0, 0), 'amount');
  assert.equal(validatePayment(1000, 0, -5), 'amount');
  // three installments with float-unfriendly values reach exactly PAID
  const parts = [333.33, 333.33, 333.34];
  assert.equal(paidFromPayments(parts.map((amount) => ({ amount }))), 1000);
  assert.equal(debtStatus(1000, paidFromPayments(parts.map((amount) => ({ amount })))), 'PAID');
  // deleting one installment reverts the status
  assert.equal(debtStatus(1000, paidFromPayments(parts.slice(0, 2).map((amount) => ({ amount })))), 'PARTIAL');
  assert.equal(suggestWalletAmount(100, 'USD', 'AED', rates), 367.26);
});

test('Dubai date inputs round-trip and month boundaries', () => {
  assert.equal(fromDubaiInput('2026-10-31T23:59'), '2026-10-31T19:59:00.000Z');
  assert.equal(toDubaiInput('2026-10-31T20:30:00Z'), '2026-11-01T00:30');
  assert.equal(fromDubaiInput('2026-02-31T10:00'), null);
  assert.equal(fromDubaiInput('garbage'), null);
  const iso = '2026-03-15T07:45:00.000Z';
  assert.equal(fromDubaiInput(toDubaiInput(iso)), iso);
  assert.equal(startOfMonthDubai(new Date('2026-10-31T21:00:00Z')).toISOString(), '2026-10-31T20:00:00.000Z'); // already Nov 1 in Dubai
});

test('fetchAllPages: more than 10,000 rows are flagged, never silently cut', async () => {
  const total = 12_345;
  const src = async (lo: number, hi: number) => Array.from({ length: Math.max(0, Math.min(hi, total - 1) - lo + 1) }, (_, i) => lo + i);
  const r = await fetchAllPages(src, 1000, 10_000);
  assert.equal(r.rows.length, 10_000);
  assert.equal(r.truncated, true);
  const ok = await fetchAllPages(src, 1000, 20_000);
  assert.equal(ok.rows.length, total);
  assert.equal(ok.truncated, false);
  assert.equal(new Set(ok.rows).size, total);
});
