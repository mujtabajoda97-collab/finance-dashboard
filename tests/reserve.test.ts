import test from 'node:test';
import assert from 'node:assert/strict';
import { freeBalance, reservedByWallet, reservedFor, spendableForProject, totalsByCurrency } from '../src/lib/reserve.ts';
import type { FundReservation, Wallet } from '../src/lib/types.ts';

const W = (id: string, currency: Wallet['currency'], balance: number, extra: Partial<Wallet> = {}): Wallet => ({
  id, name: id, currency, opening_balance: 0, balance, min_balance_threshold: 0, is_archived: false, created_at: '', updated_at: '', ...extra,
});
const R = (project_id: string, wallet_id: string, amount: number): FundReservation => ({
  id: Math.random().toString(), project_id, wallet_id, amount, project_amount: amount, created_at: '',
});

test('reserved totals per wallet and free balance', () => {
  const m = reservedByWallet([R('p1', 'a', 2000), R('p2', 'a', 500.5), R('p1', 'b', 100)]);
  assert.equal(m.get('a'), 2500.5);
  assert.equal(freeBalance(W('a', 'AED', 3000), m), 499.5);
  assert.equal(freeBalance(W('c', 'AED', 70), m), 70);
});

test('reservedFor and spendableForProject', () => {
  const rows = [R('p1', 'a', 2000), R('p2', 'a', 500)];
  assert.equal(reservedFor(rows, 'p1', 'a'), 2000);
  assert.equal(spendableForProject(W('a', 'AED', 3000), rows, 'p1'), 2500); // only p2's 500 is off-limits
});

test('totals are grouped by currency, skip archived wallets and empty currencies', () => {
  const wallets = [W('a', 'AED', 3000), W('b', 'AED', 1000, { min_balance_threshold: 2000 }), W('s', 'SDG', 90000),
    W('x', 'AED', 999, { is_archived: true })];
  const t = totalsByCurrency(wallets, reservedByWallet([R('p', 'a', 1500)]));
  assert.deepEqual(t.map((c) => c.currency), ['AED', 'SDG']);
  assert.equal(t[0].total, 4000);
  assert.equal(t[0].reserved, 1500);
  assert.equal(t[0].free, 2500);
  assert.equal(t[0].wallets, 2);
  assert.equal(t[0].low, 1);
  assert.equal(t[1].free, 90000);
});
