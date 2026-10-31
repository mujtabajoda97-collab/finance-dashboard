import { remaining } from './debt';
import { dubaiParts } from './time';
import type { Debt, Task, Wallet } from './types';

export interface LiveAlert {
  id: string;
  level: 'warn' | 'info';
  kind: 'LOW_BALANCE' | 'DEBT_OVERDUE' | 'TASK_OVERDUE';
  ref: string;
}

/** "YYYY-MM-DD" for today in Dubai. */
export function todayDubai(d: Date = new Date()): string {
  const p = dubaiParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export const isOpenDebt = (d: Debt) => d.status !== 'PAID' && remaining(d.total_amount, d.paid_amount) > 0;
/** Open debt that has a due date. */
export const isOpenDebtDue = (d: Debt) => isOpenDebt(d) && !!d.due_date;
export const isDebtOverdue = (d: Debt, today = todayDubai()) => isOpenDebt(d) && !!d.due_date && d.due_date < today;
export const isLowWallet = (w: Wallet) => w.min_balance_threshold > 0 && w.balance <= w.min_balance_threshold;
export const isTaskOverdue = (t: Task, now = Date.now()) => !t.is_completed && !!t.due_date && new Date(t.due_date).getTime() < now;

/** Conditions that are true right now (computed in the app; the database alert log is shown separately). */
export function liveAlerts(wallets: Wallet[], tasks: Task[], debts: Debt[]): LiveAlert[] {
  const out: LiveAlert[] = [];
  for (const w of wallets) if (isLowWallet(w)) out.push({ id: `w-${w.id}`, level: 'warn', kind: 'LOW_BALANCE', ref: w.name });
  const late = tasks.filter((t) => isTaskOverdue(t));
  if (late.length) out.push({ id: 'tasks-late', level: 'warn', kind: 'TASK_OVERDUE', ref: String(late.length) });
  for (const d of debts) if (isDebtOverdue(d)) out.push({ id: `d-${d.id}`, level: 'warn', kind: 'DEBT_OVERDUE', ref: d.person_name });
  return out;
}

/** Start of the Dubai week (Monday 00:00) as an instant. Dubai has no DST: UTC+4. */
export function startOfWeekDubai(d: Date = new Date()): Date {
  const p = dubaiParts(d);
  const local = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dow = (local.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(Date.UTC(p.year, p.month - 1, p.day - dow) - 4 * 3600_000);
}
