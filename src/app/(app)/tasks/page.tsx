'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Bell, Check, Loader2, Plus, RefreshCw, Repeat } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { Sheet } from '@/components/Sheet';
import { PriorityBadge } from '@/components/tasks/PriorityBadge';
import { AlertPicker } from '@/components/AlertPicker';
import { AlarmToggle } from '@/components/AlarmToggle';
import { setAlarmFlag } from '@/lib/alarm';
import { px } from '@/lib/ptext';
import { choiceFromMinutes, minutesFromChoice, type AlertChoice } from '@/lib/alertPrefs';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { tx } from '@/lib/text';
import { isTaskOverdue, startOfWeekDubai } from '@/lib/derived';
import { APP_TZ, endOfDayDubai, fromDubaiInput, intlLocale, isSameDubaiDay, toDubaiInput } from '@/lib/time';
import type { PeriodType, Priority, Task } from '@/lib/types';

type Filter = 'today' | 'week' | 'late';
const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
const PERIODS: PeriodType[] = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'];

export default function TasksPage() {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const data = useData();
  const [filter, setFilter] = useState<Filter>('today');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);

  const now = Date.now();
  const endToday = endOfDayDubai().getTime();
  const endWeek = startOfWeekDubai().getTime() + 7 * 86_400_000;

  const { late, today, week } = useMemo(() => {
    const open = data.tasks.filter((t) => !t.is_completed);
    const lateList = open.filter((t) => isTaskOverdue(t, now));
    const rest = open.filter((t) => !isTaskOverdue(t, now));
    return {
      late: lateList,
      today: rest.filter((t) => !t.due_date || new Date(t.due_date).getTime() <= endToday),
      week: rest.filter((t) => !t.due_date || new Date(t.due_date).getTime() < endWeek),
    };
  }, [data.tasks, now, endToday, endWeek]);

  const list = filter === 'late' ? late : filter === 'week' ? week : today;
  const timeFmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, weekday: 'short', day: 'numeric', month: 'short' });

  async function complete(task: Task) {
    data.setTasks((ts) => ts.filter((x) => x.id !== task.id));
    const { error } = await supabase().from('tasks').update({ is_completed: true }).eq('id', task.id);
    if (error) {
      notify(error.message, 'error');
      data.setTasks((ts) => [...ts, task]);
      return;
    }
    if (task.period_type !== 'NONE') await data.loadTasks();
  }

  if (data.error) {
    return (
      <div className="card text-center">
        <p className="mb-3 text-sm text-rose-700 dark:text-rose-400">{T('error')}: {data.error}</p>
        <button type="button" className="btn btn-primary" onClick={data.loadAll}><RefreshCw className="size-4" aria-hidden /> {T('retry')}</button>
      </div>
    );
  }
  if (data.loading && data.tasks.length === 0) {
    return <div className="flex justify-center py-20"><Loader2 className="size-6 animate-spin text-brand-500" aria-label={T('loading')} /></div>;
  }

  const tabs: { id: Filter; label: string; n: number }[] = [
    { id: 'today', label: T('fToday'), n: today.length },
    { id: 'week', label: T('fWeek'), n: week.length },
    { id: 'late', label: T('fLate'), n: late.length },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-3 pb-16">
      <div className="flex gap-2" role="tablist" aria-label={T('tasks')}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={filter === tab.id}
            onClick={() => setFilter(tab.id)}
            className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
              filter === tab.id ? 'border-brand-500 bg-brand-500 text-night' : 'border-line text-muted dark:border-night-line dark:text-night-muted'
            }`}
          >
            {tab.label} <span className="num text-xs opacity-80">{tab.n}</span>
          </button>
        ))}
      </div>

      {late.length > 0 && filter !== 'late' && (
        <button type="button" onClick={() => setFilter('late')} className="flex w-full items-center gap-2 rounded-2xl border border-rose-400/40 bg-rose-500/15 px-4 py-3 text-sm font-semibold text-rose-700 dark:text-rose-200">
          <AlertTriangle className="size-4 shrink-0" aria-hidden /> {T('lateWarn')}
        </button>
      )}

      {list.length === 0 ? (
        <p className="card py-10 text-center text-sm text-muted dark:text-night-muted">{T('noTasksFilter')}</p>
      ) : (
        <ul className="space-y-2.5">
          {list.map((task) => {
            const d = task.due_date ? new Date(task.due_date) : null;
            const lateTask = isTaskOverdue(task, now);
            return (
              <li key={task.id} className={`card flex items-start gap-3 !p-3.5 ${lateTask ? '!border-rose-400/40' : ''}`}>
                <button
                  type="button"
                  onClick={() => complete(task)}
                  aria-label={`✓ ${task.title}`}
                  className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-md border-2 border-brand-500/70 text-brand-700 dark:text-brand-400 transition hover:bg-brand-500/20"
                >
                  <Check className="size-4 opacity-0 hover:opacity-100" aria-hidden />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{task.title}</p>
                  {d && (
                    <p className={`num mt-0.5 text-xs ${lateTask ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-muted dark:text-night-muted'}`}>
                      {isSameDubaiDay(d) ? T('fToday') : dateFmt.format(d)} · {timeFmt.format(d)}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <PriorityBadge priority={task.priority} />
                    {task.period_type !== 'NONE' && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 text-[11px] font-bold text-sky-700 dark:text-sky-300">
                        <Repeat className="size-3" aria-hidden />{T(task.period_type)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(task)}
                  aria-label={T('editAlert')}
                  title={T('editAlert')}
                  className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-brand-500/15 hover:text-brand-600 dark:text-night-muted dark:hover:text-brand-400"
                >
                  <Bell className={`size-4 ${task.alarm_enabled ? 'fill-current text-brand-600 dark:text-brand-400' : ''}`} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setAdding(true)}
        className="btn btn-primary fixed bottom-24 end-5 z-20 rounded-full px-5 py-3.5 shadow-lg shadow-black/40 lg:bottom-8"
      >
        <Plus className="size-5" aria-hidden /> {T('quickAdd')}
      </button>

      {adding && (
        <Sheet title={T('quickAdd')} onClose={() => setAdding(false)}>
          <AddTask onDone={async () => { setAdding(false); await data.loadTasks(); }} />
        </Sheet>
      )}
      {editing && (
        <Sheet title={T('editAlert')} onClose={() => setEditing(null)}>
          <EditAlert task={editing} onDone={async () => { setEditing(null); await data.loadTasks(); }} />
        </Sheet>
      )}
    </div>
  );
}

function AddTask({ onDone }: { onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [period, setPeriod] = useState<PeriodType>('NONE');
  const [when, setWhen] = useState(() => toDubaiInput(new Date(Date.now() + 3600_000)));
  const [alert, setAlert] = useState<AlertChoice>(() => ({ mode: '1h', custom: toDubaiInput(new Date(Date.now() + 1800_000)) }));
  const [alertErr, setAlertErr] = useState(false);
  const [alarm, setAlarm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    const dueIso = fromDubaiInput(when);
    if (!dueIso) return notify(T('alertNeedsDue'), 'error');
    const minutes = minutesFromChoice(alert, new Date(dueIso));
    if (minutes === null) { setAlertErr(true); return; }
    setAlertErr(false);
    setBusy(true);
    const { data: created, error } = await supabase()
      .from('tasks')
      .insert({ title: title.trim(), priority, period_type: period, due_date: dueIso, remind_before_minutes: minutes })
      .select('id')
      .single();
    if (error) { setBusy(false); return notify(error.message, 'error'); }
    if (alarm && created?.id && !(await setAlarmFlag('tasks', created.id as string, true))) notify(px(lang, 'alarmSaveFail'), 'error');
    setBusy(false);
    await onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <label className="block">
        <span className="label">{T('taskTitle')}</span>
        <input autoFocus className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="block">
        <span className="label">{T('date')} / {T('time')}</span>
        <input type="datetime-local" dir="ltr" className="field num font-mono" value={when} onChange={(e) => setWhen(e.target.value)} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className="label">{T('priority')}</span>
          <select className="field" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => <option key={p} value={p}>{T(p)}</option>)}
          </select>
        </label>
        <label>
          <span className="label">{T('repeat')}</span>
          <select className="field" value={period} onChange={(e) => setPeriod(e.target.value as PeriodType)}>
            {PERIODS.map((p) => <option key={p} value={p}>{T(p)}</option>)}
          </select>
        </label>
      </div>
      <AlertPicker value={alert} onChange={(v) => { setAlert(v); setAlertErr(false); }} error={alertErr} />
      <AlarmToggle on={alarm} onChange={setAlarm} note={px(lang, 'alarmAtNote')} />
      <button type="submit" disabled={busy || !title.trim()} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('add')}
      </button>
    </form>
  );
}

function EditAlert({ task, onDone }: { task: Task; onDone: () => Promise<void> }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const due = task.due_date ? new Date(task.due_date) : null;
  const [choice, setChoice] = useState<AlertChoice>(() => choiceFromMinutes(task.remind_before_minutes, due));
  const [alarm, setAlarm] = useState(!!task.alarm_enabled);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!due || busy) return;
    const minutes = minutesFromChoice(choice, due);
    if (minutes === null) { setErr(true); return; }
    setBusy(true);
    const { error } = await supabase().from('tasks').update({ remind_before_minutes: minutes }).eq('id', task.id);
    if (error) { setBusy(false); return notify(error.message, 'error'); }
    if (alarm !== !!task.alarm_enabled && !(await setAlarmFlag('tasks', task.id, alarm))) notify(px(lang, 'alarmSaveFail'), 'error');
    setBusy(false);
    notify(T('alertSaved'));
    await onDone();
  }

  return (
    <div className="space-y-4">
      <p className="font-semibold">{task.title}</p>
      {!due && <p className="text-sm text-amber-800 dark:text-amber-300">{T('alertNeedsDue')}</p>}
      <AlertPicker value={choice} onChange={(v) => { setChoice(v); setErr(false); }} disabled={!due} error={err} />
      <AlarmToggle on={alarm} onChange={setAlarm} disabled={!due} note={px(lang, 'alarmAtNote')} />
      <button type="button" onClick={save} disabled={!due || busy} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} {T('save')}
      </button>
    </div>
  );
}
