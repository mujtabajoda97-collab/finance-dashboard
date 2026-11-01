import { debtFireAt, taskFireAt } from './alertPrefs';
import { formatMoney } from './currency';
import { remaining } from './debt';
import { isOpenDebtDue } from './derived';
import { flowRest } from './projects';
import type { Debt, Project, ProjectCashflow, Task } from './types';

/**
 * Voice alarms.
 *  - Android app (Capacitor): scheduled as repeating Local Notifications on a dedicated high-importance
 *    channel with a bundled alarm tone, so they ring even when the app is closed.
 *  - Browser / installed PWA: the app rings (WebAudio) while it is open; see AlarmEngine.
 * The per-item on/off switch is the alarm_enabled column (SQL 0009).
 */

export type AlarmTable = 'tasks' | 'debts' | 'project_cashflows';

/** Best effort: false when the column does not exist yet (SQL 0009 not applied) or the update failed. */
export async function setAlarmFlag(table: AlarmTable, id: string, on: boolean): Promise<boolean> {
  try {
    const { supabase } = await import('./supabase'); // loaded on demand so the pure planning code stays dependency-free
    const { error } = await supabase().from(table).update({ alarm_enabled: on }).eq('id', id);
    return !error;
  } catch {
    return false;
  }
}

export interface AlarmItem {
  /** Stable identity of the thing that rings (task:ID, debt:ID, flow:ID). */
  key: string;
  /** When it first rings (epoch ms). */
  at: number;
  title: string;
  body: string;
  url: string;
}

export interface AlarmLabels {
  lang: 'ar' | 'en';
  task: string;
  debt: string;
  flow: string;
}

export const WINDOW_MS = 10 * 60_000; // an alarm that is up to 10 minutes late still rings in the open app
const HORIZON_MS = 30 * 86_400_000; // only the next 30 days are scheduled on the phone
const MAX_ITEMS = 40;

/** Date-only items (project cash-flow lines) ring at 09:00 Dubai time (UTC+4) on their due date. */
export function dateAt9Dubai(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 9, 0) - 4 * 3600_000 : null;
}

export function buildAlarmItems(
  src: { tasks: Task[]; debts: Debt[]; projects: Project[]; cashflows: ProjectCashflow[] },
  labels: AlarmLabels,
  now: number,
): AlarmItem[] {
  const out: AlarmItem[] = [];
  const keep = (at: number | null): at is number => at !== null && at > now - WINDOW_MS && at < now + HORIZON_MS;

  for (const t of src.tasks) {
    if (!t.alarm_enabled || t.is_completed) continue;
    const at = taskFireAt(t);
    if (keep(at)) out.push({ key: `task:${t.id}`, at, title: `⏰ ${labels.task}`, body: t.title, url: '/tasks/' });
  }
  for (const d of src.debts) {
    if (!d.alarm_enabled || !isOpenDebtDue(d)) continue;
    const at = debtFireAt(d);
    if (keep(at)) {
      out.push({
        key: `debt:${d.id}`, at, title: `⏰ ${labels.debt}`, url: '/debts/',
        body: `${d.person_name} — ${formatMoney(remaining(d.total_amount, d.paid_amount), d.currency, labels.lang)}`,
      });
    }
  }
  const byProject = new Map(src.projects.map((p) => [p.id, p]));
  for (const f of src.cashflows) {
    if (!f.alarm_enabled || f.is_done || !f.due_date || flowRest(f) <= 0) continue;
    const at = dateAt9Dubai(f.due_date);
    if (keep(at)) {
      const p = byProject.get(f.project_id);
      out.push({
        key: `flow:${f.id}`, at, title: `⏰ ${labels.flow}`, url: '/finance/?tab=projects',
        body: `${p ? `${p.name} · ` : ''}${f.title} — ${formatMoney(flowRest(f), f.currency, labels.lang)}`,
      });
    }
  }
  return out.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key)).slice(0, MAX_ITEMS);
}

// ---- native scheduling plan (pure, unit-tested) ----
export const ALARM_BASE = 100_000_000; // ids of our notifications live in [ALARM_BASE, ALARM_BASE + BUCKETS*SLOTS)
export const BUCKETS = 100_000;
export const SLOTS = 20;
export const REPEATS = 8; // rings 8 times, one minute apart, unless it is stopped
export const STEP_MS = 60_000;

function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export interface PlanEntry {
  id: number;
  at: number;
  key: string;
  seriesAt: number;
  title: string;
  body: string;
  url: string;
}

export const ackKey = (key: string, at: number) => `${key}@${at}`;

/** Every notification to schedule: each item rings REPEATS times; acknowledged series and past times are skipped. */
export function alarmPlan(items: AlarmItem[], now: number, acked: Record<string, number>): PlanEntry[] {
  const used = new Set<number>();
  const plan: PlanEntry[] = [];
  for (const it of items) {
    if (acked[ackKey(it.key, it.at)]) continue;
    let bucket = fnv(ackKey(it.key, it.at)) % BUCKETS;
    while (used.has(bucket)) bucket = (bucket + 1) % BUCKETS;
    used.add(bucket);
    const base = ALARM_BASE + bucket * SLOTS;
    for (let i = 0; i < REPEATS; i++) {
      const at = it.at + i * STEP_MS;
      if (at <= now + 2_000) continue;
      plan.push({ id: base + i, at, key: it.key, seriesAt: it.at, title: it.title, body: it.body, url: it.url });
    }
  }
  return plan;
}

export const isAlarmId = (id: number) => id >= ALARM_BASE && id < ALARM_BASE + BUCKETS * SLOTS;
/** Pending alarm notifications that are no longer wanted (item removed, switched off, done, or acknowledged). */
export const staleIds = (pending: number[], plan: PlanEntry[]): number[] => {
  const keep = new Set(plan.map((p) => p.id));
  return pending.filter((id) => isAlarmId(id) && !keep.has(id));
};
/** All notification ids of the series that `id` belongs to. */
export const seriesOf = (id: number): number[] => {
  const base = id - ((id - ALARM_BASE) % SLOTS);
  return Array.from({ length: REPEATS }, (_, i) => base + i);
};

/** Items that should be ringing right now in the open app (not yet acknowledged). */
export function dueNow(items: AlarmItem[], now: number, acked: Record<string, number>): AlarmItem[] {
  return items.filter((it) => it.at <= now && now < it.at + WINDOW_MS && !acked[ackKey(it.key, it.at)]);
}

// ---- acknowledged log (this device) ----
const ACK = 'alarm_ack_v1';
export function readAcked(): Record<string, number> {
  try {
    const raw = localStorage.getItem(ACK);
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
export function ackAlarm(key: string, at: number): void {
  try {
    const now = Date.now();
    const all = readAcked();
    all[ackKey(key, at)] = now;
    for (const k of Object.keys(all)) if (now - all[k] > 7 * 86_400_000) delete all[k];
    localStorage.setItem(ACK, JSON.stringify(all));
  } catch {
    /* private mode */
  }
}

// ---- Capacitor bridge (no import: the native shell injects window.Capacitor into the remote page) ----
export const ALARM_CHANNEL = 'lifeos-alarm';

export interface LocalNotificationsApi {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  createChannel(c: Record<string, unknown>): Promise<void>;
  schedule(o: { notifications: Record<string, unknown>[] }): Promise<unknown>;
  cancel(o: { notifications: { id: number }[] }): Promise<void>;
  getPending(): Promise<{ notifications: { id: number }[] }>;
  addListener(ev: string, cb: (e: { notification?: { id?: number; extra?: { key?: string; at?: number; url?: string } } }) => void): Promise<{ remove(): Promise<void> }>;
}
interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  Plugins?: Record<string, unknown>;
  registerPlugin?: (name: string) => unknown;
}
let cached: LocalNotificationsApi | null | undefined;

export function nativeNotifications(): LocalNotificationsApi | null {
  if (cached !== undefined) return cached;
  if (typeof window === 'undefined') return null;
  const cap = (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;
  if (!cap?.isNativePlatform?.()) return (cached = null);
  const plugin = (cap.Plugins?.LocalNotifications ?? cap.registerPlugin?.('LocalNotifications')) as LocalNotificationsApi | undefined;
  return (cached = plugin ?? null);
}
export const isNativeApp = () => nativeNotifications() !== null;

export async function ensureAlarmChannel(ln: LocalNotificationsApi): Promise<void> {
  await ln.createChannel({
    id: ALARM_CHANNEL,
    name: 'Life OS alarm — منبه Life OS',
    description: 'Voice alarms for tasks, debts and project items',
    importance: 5,
    visibility: 1,
    sound: 'alarm.wav',
    vibration: true,
    lights: true,
  });
}

export async function ensureAlarmPermission(ln: LocalNotificationsApi, ask: boolean): Promise<boolean> {
  let st = (await ln.checkPermissions()).display;
  if (st !== 'granted' && ask) st = (await ln.requestPermissions()).display;
  return st === 'granted';
}

export async function syncNativeAlarms(ln: LocalNotificationsApi, plan: PlanEntry[]): Promise<void> {
  const pending = (await ln.getPending()).notifications.map((n) => n.id);
  const stale = staleIds(pending, plan);
  if (stale.length) await ln.cancel({ notifications: stale.map((id) => ({ id })) });
  if (plan.length) {
    await ln.schedule({
      notifications: plan.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.body,
        channelId: ALARM_CHANNEL,
        schedule: { at: new Date(p.at), allowWhileIdle: true },
        extra: { key: p.key, at: p.seriesAt, url: p.url },
      })),
    });
  }
}

export const TEST_EVENT = 'lifeos:alarm-test';

/** Settings button: rings in 10 seconds (native: scheduled on the phone; browser: the open app rings). */
export async function scheduleTestAlarm(title: string, body: string): Promise<'native' | 'web'> {
  const at = Date.now() + 10_000;
  const ln = nativeNotifications();
  if (ln) {
    await ensureAlarmChannel(ln);
    const base = ALARM_BASE + BUCKETS * SLOTS; // just outside the managed range, so syncing never cancels the test
    await ln.schedule({
      notifications: [0, 1, 2].map((i) => ({
        id: base + i, title, body, channelId: ALARM_CHANNEL,
        schedule: { at: new Date(at + i * STEP_MS), allowWhileIdle: true },
        extra: { key: 'test', at, url: '/settings/' },
      })),
    });
    return 'native';
  }
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(TEST_EVENT, { detail: { key: 'test', at, title, body, url: '/settings/' } })), 10_000);
  return 'web';
}
