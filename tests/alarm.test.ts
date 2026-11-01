import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ackKey, alarmPlan, ALARM_BASE, BUCKETS, buildAlarmItems, dateAt9Dubai, dueNow, isAlarmId, REPEATS, seriesOf, SLOTS, staleIds, STEP_MS, WINDOW_MS,
} from '../src/lib/alarm.ts';
import type { Debt, Project, ProjectCashflow, Task } from '../src/lib/types.ts';

const NOW = Date.parse('2026-11-01T10:00:00Z');
const labels = { lang: 'en' as const, task: 'Task', debt: 'Debt', flow: 'Project item' };
const task = (id: string, due: string | null, extra: Partial<Task> = {}): Task => ({
  id, title: `T${id}`, description: null, priority: 'MEDIUM', due_date: due, period_type: 'NONE', remind_before_minutes: 0,
  is_completed: false, completed_at: null, last_notified_at: null, created_at: '', alarm_enabled: true, ...extra,
});
const debt = (id: string, due: string | null, extra: Partial<Debt> = {}): Debt => ({
  id, person_name: `P${id}`, type: 'PAYABLE', currency: 'AED', total_amount: 1000, paid_amount: 200, due_date: due, status: 'PARTIAL',
  notes: null, created_at: '', remind_before_minutes: 0, alarm_enabled: true, ...extra,
});
const flow = (id: string, due: string | null, extra: Partial<ProjectCashflow> = {}): ProjectCashflow => ({
  id, project_id: 'p1', direction: 'OUT', title: `F${id}`, amount: 4000, currency: 'AED', due_date: due, is_done: false, debt_id: null, paid_amount: 2000, alarm_enabled: true, ...extra,
});
const project: Project = { id: 'p1', name: 'Event', budget: 5000, currency: 'AED', allocated_amount: 0, notes: null, is_archived: false, created_at: '' };
const src = (o: Partial<{ tasks: Task[]; debts: Debt[]; cashflows: ProjectCashflow[] }>) => ({ tasks: [], debts: [], projects: [project], cashflows: [], ...o });

test('only items with the switch on, not done, with a future time become alarms', () => {
  const items = buildAlarmItems(src({
    tasks: [task('1', '2026-11-01T12:00:00Z'), task('2', '2026-11-01T12:00:00Z', { alarm_enabled: false }), task('3', '2026-11-01T12:00:00Z', { is_completed: true }), task('4', null)],
    debts: [debt('1', '2026-11-02'), debt('2', '2026-11-02', { alarm_enabled: false }), debt('3', '2026-11-02', { status: 'PAID', paid_amount: 1000 })],
    cashflows: [flow('1', '2026-11-03'), flow('2', '2026-11-03', { alarm_enabled: false }), flow('3', '2026-11-03', { is_done: true }), flow('4', null)],
  }), labels, NOW);
  assert.deepEqual(items.map((i) => i.key), ['task:1', 'debt:1', 'flow:1']);
});

test('task alarm uses the chosen reminder lead time; debts and flow lines ring at 09:00 Dubai', () => {
  const items = buildAlarmItems(src({
    tasks: [task('1', '2026-11-01T12:00:00Z', { remind_before_minutes: 60 })],
    debts: [debt('1', '2026-11-02')],
    cashflows: [flow('1', '2026-11-03')],
  }), labels, NOW);
  assert.equal(new Date(items[0].at).toISOString(), '2026-11-01T11:00:00.000Z');
  assert.equal(new Date(items[1].at).toISOString(), '2026-11-02T05:00:00.000Z'); // 09:00 Dubai
  assert.equal(new Date(items[2].at).toISOString(), '2026-11-03T05:00:00.000Z');
  assert.equal(dateAt9Dubai('2026-11-03'), Date.parse('2026-11-03T05:00:00Z'));
  assert.match(items[1].body, /P1 — 800\.00 AED/);
  assert.match(items[2].body, /Event · F1 — 2,000\.00 AED/);
});

test('alarms further than 30 days away or older than the ring window are left out', () => {
  const items = buildAlarmItems(src({
    tasks: [task('far', '2026-12-31T12:00:00Z'), task('old', '2026-11-01T09:00:00Z'), task('late', '2026-11-01T09:55:00Z')],
  }), labels, NOW);
  assert.deepEqual(items.map((i) => i.key), ['task:late']);
});

test('plan: each alarm rings REPEATS times a minute apart, in the managed id range', () => {
  const items = buildAlarmItems(src({ tasks: [task('1', '2026-11-01T12:00:00Z')] }), labels, NOW);
  const plan = alarmPlan(items, NOW, {});
  assert.equal(plan.length, REPEATS);
  assert.deepEqual(plan.map((p) => p.at - plan[0].at), Array.from({ length: REPEATS }, (_, i) => i * STEP_MS));
  assert.ok(plan.every((p) => isAlarmId(p.id)));
  assert.equal(new Set(plan.map((p) => p.id)).size, REPEATS);
  assert.deepEqual(seriesOf(plan[3].id), plan.map((p) => p.id));
});

test('plan: acknowledged series and already-passed repeats are skipped', () => {
  const items = buildAlarmItems(src({ tasks: [task('1', '2026-11-01T09:57:00Z')] }), labels, NOW); // rang 3 minutes ago
  const plan = alarmPlan(items, NOW, {});
  assert.equal(plan.length, REPEATS - 4); // the repeats at +0..+3 minutes are past; +4..+7 remain
  assert.equal(alarmPlan(items, NOW, { [ackKey(items[0].key, items[0].at)]: NOW }).length, 0);
});

test('plan: different items never share an id even if their hash buckets collide', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ key: `task:${i}`, at: NOW + 3600_000 + i * 1000, title: 't', body: 'b', url: '/' }));
  const ids = alarmPlan(items, NOW, {}).map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id >= ALARM_BASE && id < ALARM_BASE + BUCKETS * SLOTS));
});

test('stale ids: only our own pending alarms that are no longer planned are cancelled', () => {
  const plan = alarmPlan([{ key: 'task:1', at: NOW + 60_000, title: 't', body: 'b', url: '/' }], NOW, {});
  const stale = staleIds([plan[0].id, ALARM_BASE + 5, 42, ALARM_BASE + BUCKETS * SLOTS + 1], plan);
  assert.deepEqual(stale, [ALARM_BASE + 5]); // foreign ids (42) and the settings test alarm (outside the range) are untouched
});

test('browser ringing: due within the window and not acknowledged', () => {
  const it = { key: 'task:1', at: NOW - 60_000, title: 't', body: 'b', url: '/' };
  assert.equal(dueNow([it], NOW, {}).length, 1);
  assert.equal(dueNow([it], NOW, { [ackKey(it.key, it.at)]: 1 }).length, 0);
  assert.equal(dueNow([{ ...it, at: NOW + 1000 }], NOW, {}).length, 0);
  assert.equal(dueNow([{ ...it, at: NOW - WINDOW_MS - 1 }], NOW, {}).length, 0);
});
