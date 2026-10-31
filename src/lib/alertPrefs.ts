import { fromDubaiInput, toDubaiInput } from './time';
import type { Debt, Task } from './types';

export type AlertMode = 'at' | '1h' | '2h' | '24h' | 'custom';
export interface AlertChoice {
  mode: AlertMode;
  /** "YYYY-MM-DDTHH:mm" in Dubai time (datetime-local value); only used when mode is "custom". */
  custom: string;
}

export const PRESET_MINUTES: Record<Exclude<AlertMode, 'custom'>, number> = { at: 0, '1h': 60, '2h': 120, '24h': 1440 };
export const MODES: AlertMode[] = ['at', '1h', '2h', '24h', 'custom'];

export function modeFromMinutes(min: number): AlertMode {
  for (const m of ['at', '1h', '2h', '24h'] as const) if (PRESET_MINUTES[m] === min) return m;
  return 'custom';
}

/** The choice that reproduces `minutes` before `due`. */
export function choiceFromMinutes(min: number, due: Date | null): AlertChoice {
  const mode = modeFromMinutes(min);
  const custom = due ? toDubaiInput(new Date(due.getTime() - min * 60_000)) : '';
  return { mode, custom: mode === 'custom' ? custom : due ? toDubaiInput(new Date(due.getTime() - 60 * 60_000)) : '' };
}

/** Whole minutes before `due` for a choice, or null when the choice is invalid (custom after the due time). */
export function minutesFromChoice(choice: AlertChoice, due: Date): number | null {
  if (choice.mode !== 'custom') return PRESET_MINUTES[choice.mode];
  const iso = fromDubaiInput(choice.custom);
  if (!iso) return null;
  const diff = Math.round((due.getTime() - new Date(iso).getTime()) / 60_000);
  return diff >= 0 ? diff : null;
}

export const taskFireAt = (t: Task): number | null =>
  t.due_date ? new Date(t.due_date).getTime() - Math.max(0, t.remind_before_minutes) * 60_000 : null;

/** A debt with only a date is treated as due at 09:00 Dubai time (UTC+4). */
export function debtDueInstant(d: Debt): number | null {
  const m = d.due_date ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d.due_date) : null;
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0) - 4 * 3600_000 : null;
}

// ---- Debt alert choices: the debts table has no reminder column, so they live on this device. ----
const KEY = 'debt_alerts_v1';
type Stored = Record<string, { mode: AlertMode; customAt?: string }>;

function readAll(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

export function getDebtChoice(id: string, due: Date | null): AlertChoice {
  const s = readAll()[id];
  if (!s) return { mode: '24h', custom: due ? toDubaiInput(new Date(due.getTime() - 60 * 60_000)) : '' };
  return { mode: s.mode, custom: s.customAt ? toDubaiInput(s.customAt) : due ? toDubaiInput(new Date(due.getTime() - 60 * 60_000)) : '' };
}

export function setDebtChoice(id: string, choice: AlertChoice): void {
  try {
    const all = readAll();
    const iso = choice.mode === 'custom' ? fromDubaiInput(choice.custom) : null;
    all[id] = { mode: choice.mode, ...(iso ? { customAt: iso } : {}) };
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* private mode: not persisted */
  }
}

export function debtFireAt(d: Debt): number | null {
  const due = debtDueInstant(d);
  if (due === null) return null;
  const s = readAll()[d.id];
  if (!s) return due - (typeof d.remind_before_minutes === 'number' ? d.remind_before_minutes : PRESET_MINUTES['24h']) * 60_000;
  if (s.mode === 'custom') return s.customAt ? new Date(s.customAt).getTime() : due - PRESET_MINUTES['24h'] * 60_000;
  return due - PRESET_MINUTES[s.mode] * 60_000;
}
