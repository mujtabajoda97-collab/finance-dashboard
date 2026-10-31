import test from 'node:test';
import assert from 'node:assert/strict';
import { flowPaid, flowRest, summarize } from '../src/lib/projects.ts';
import type { Project, ProjectCashflow } from '../src/lib/types.ts';

const rates = { AED: 1, USD: 0.27, SDG: 600 };
const P = (extra: Partial<Project> = {}): Project => ({
  id: 'p', name: 'Event', budget: 10000, currency: 'AED', allocated_amount: 2000, notes: null,
  is_archived: false, created_at: '', target_date: '2026-12-01', ...extra,
});
const F = (extra: Partial<ProjectCashflow>): ProjectCashflow => ({
  id: Math.random().toString(), project_id: 'p', direction: 'OUT', title: 't', amount: 1000, currency: 'AED',
  due_date: null, is_done: false, debt_id: null, paid_amount: 0, ...extra,
});
const TODAY = '2026-10-31';

test('executed spending reduces the remaining cost', () => {
  const s = summarize(P(), [F({ direction: 'OUT', amount: 1000, is_done: true, paid_amount: 1000 })], rates, TODAY);
  assert.equal(s.spent, 1000);
  assert.equal(s.remainingCost, 9000);
  assert.equal(s.totalCost, 10000);
});

test('partial receipt: paid part is not pending any more, rest stays', () => {
  const f = F({ direction: 'IN', amount: 3000, paid_amount: 1000, due_date: '2026-11-15' });
  assert.equal(flowPaid(f), 1000);
  assert.equal(flowRest(f), 2000);
  // the received 1000 was already added to allocated (2000 -> 3000) by project_receive
  const s = summarize(P({ allocated_amount: 3000 }), [f], rates, TODAY);
  assert.equal(s.pendingIn, 2000);
  assert.equal(s.inBefore, 2000);
  assert.equal(s.net, 3000 + 2000 - 10000);
});

test('inflows after the target date are not counted for coverage', () => {
  const s = summarize(P(), [
    F({ direction: 'IN', amount: 5000, due_date: '2026-11-20' }),
    F({ direction: 'IN', amount: 4000, due_date: '2026-12-20' }),
  ], rates, TODAY);
  assert.equal(s.inBefore, 5000);
  assert.equal(s.inAfter, 4000);
  assert.equal(s.net, 2000 + 5000 - 10000); // deficit 3000
  assert.equal(s.needed, 0); // all pending inflows together would cover it
  assert.equal(s.daysLeft, 31);
});

test('surplus when funds exceed the remaining cost', () => {
  const s = summarize(P({ allocated_amount: 9000 }), [F({ direction: 'IN', amount: 3000, due_date: '2026-11-01' })], rates, TODAY);
  assert.equal(s.net, 9000 + 3000 - 10000);
  assert.ok(s.net > 0);
});

test('planned spending above budget raises the total cost', () => {
  const s = summarize(P({ budget: 1000 }), [F({ amount: 1500 })], rates, TODAY);
  assert.equal(s.remainingCost, 1500);
});

test('mixed currencies are converted to the project currency; missing rate is flagged', () => {
  const s = summarize(P(), [F({ direction: 'IN', amount: 270, currency: 'USD' })], rates, TODAY);
  assert.equal(Math.round(s.pendingIn), 1000);
  const s2 = summarize(P(), [F({ direction: 'IN', amount: 100, currency: 'SDG' })], { AED: 1 }, TODAY);
  assert.equal(s2.partial, true);
  assert.equal(s2.pendingIn, 0);
});

test('legacy rows (no paid_amount) treat is_done as fully paid', () => {
  const f = F({ is_done: true, paid_amount: undefined });
  assert.equal(flowPaid(f), 1000);
  assert.equal(flowRest(f), 0);
});
