'use client';

import { useState } from 'react';
import { Check, Loader2, Plus, Repeat, SlidersHorizontal } from 'lucide-react';
import { useApp } from './Providers';
import { supabase } from '@/lib/supabase';
import { APP_TZ, dubaiTimeToday, intlLocale, isSameDubaiDay, nowPlusHourHHMM } from '@/lib/time';
import type { PeriodType, Priority, Task } from '@/lib/types';

const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const PERIODS: PeriodType[] = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY'];

const priorityStyle: Record<Priority, string> = {
  LOW: 'bg-slate-300 dark:bg-slate-600',
  MEDIUM: 'bg-sky-500',
  HIGH: 'bg-amber-500',
  CRITICAL: 'bg-rose-600',
};

interface Props {
  tasks: Task[];
  setTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onChanged: () => Promise<void> | void;
}

export function QuickTasks({ tasks, setTasks, onChanged }: Props) {
  const { t, lang, notify } = useApp();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('MEDIUM');
  const [time, setTime] = useState(nowPlusHourHHMM);
  const [period, setPeriod] = useState<PeriodType>('NONE');
  const [showOptions, setShowOptions] = useState(false);
  const [busy, setBusy] = useState(false);

  const now = Date.now();
  const overdue = tasks.filter((x) => x.due_date && new Date(x.due_date).getTime() < now);
  const upcoming = tasks.filter((x) => !x.due_date || new Date(x.due_date).getTime() >= now);

  const timeFmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });
  const dateFmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, day: 'numeric', month: 'short' });

  function dueLabel(task: Task) {
    if (!task.due_date) return null;
    const d = new Date(task.due_date);
    const sameDay = isSameDubaiDay(d);
    return sameDay ? timeFmt.format(d) : `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const [h, m] = time.split(':').map(Number);
    const due = dubaiTimeToday(h || 0, m || 0);
    setBusy(true);
    const { error } = await supabase()
      .from('tasks')
      .insert({ title: title.trim(), priority, due_date: due.toISOString(), period_type: period });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    setTitle('');
    setPeriod('NONE');
    setTime(nowPlusHourHHMM());
    await onChanged();
  }

  async function complete(task: Task) {
    // Optimistic: hide immediately, roll back on failure.
    setTasks((ts) => ts.filter((x) => x.id !== task.id));
    const { error } = await supabase().from('tasks').update({ is_completed: true }).eq('id', task.id);
    if (error) {
      notify(error.message, 'error');
      setTasks((ts) => [...ts, task]);
      return;
    }
    // A recurring task spawns its next occurrence server-side; refresh to stay exact.
    if (task.period_type !== 'NONE') await onChanged();
  }

  function renderRow(task: Task, late = false) {
    return (
      <li key={task.id} className="flex items-center gap-3 py-2.5">
        <button
          type="button"
          onClick={() => complete(task)}
          aria-label={`✓ ${task.title}`}
          className="group inline-flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-line transition hover:border-brand-500 hover:bg-brand-50 dark:border-night-line dark:hover:bg-brand-900/40"
        >
          <Check className="size-3.5 text-brand-600 opacity-0 transition group-hover:opacity-100" aria-hidden />
        </button>
        <span className={`size-2 shrink-0 rounded-full ${priorityStyle[task.priority]}`} title={t(task.priority)} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
        {task.period_type !== 'NONE' && <Repeat className="size-3.5 shrink-0 text-muted dark:text-night-muted" aria-label={t(task.period_type)} />}
        {dueLabel(task) && (
          <span className={`num shrink-0 font-mono text-xs ${late ? 'font-semibold text-rose-600 dark:text-rose-300' : 'text-muted dark:text-night-muted'}`}>
            {dueLabel(task)}
          </span>
        )}
      </li>
    );
  }

  return (
    <section className="card" aria-labelledby="tasks-title">
      <div className="mb-2 flex items-center justify-between">
        <h2 id="tasks-title" className="text-base font-bold">{t('quickTasks')}</h2>
        {overdue.length > 0 && (
          <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            {overdue.length} {t('overdue')}
          </span>
        )}
      </div>

      {tasks.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted dark:text-night-muted">{t('noTasks')}</p>
      ) : (
        <>
          {overdue.length > 0 && (
            <>
              <p className="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">{t('overdue')}</p>
              <ul className="divide-y divide-line dark:divide-night-line">
                {overdue.map((task) => renderRow(task, true))}
              </ul>
            </>
          )}
          {upcoming.length > 0 && (
            <>
              <p className="mt-2 text-xs font-bold text-muted dark:text-night-muted">{t('today')}</p>
              <ul className="divide-y divide-line dark:divide-night-line">
                {upcoming.map((task) => renderRow(task))}
              </ul>
            </>
          )}
        </>
      )}

      {/* Quick add */}
      <form onSubmit={add} className="mt-3 space-y-3 border-t border-line pt-3 dark:border-night-line">
        <div className="flex gap-2">
          <input aria-label={t('addTaskPlaceholder')} className="field min-w-0 flex-1 text-sm" placeholder={t('addTaskPlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="button" onClick={() => setShowOptions((s) => !s)} aria-expanded={showOptions} className="icon-btn size-11 shrink-0 rounded-2xl" aria-label={t('priority')}>
            <SlidersHorizontal className="size-4" aria-hidden />
          </button>
          <button type="submit" disabled={busy || !title.trim()} className="btn btn-primary size-11 shrink-0 p-0" aria-label={t('add')}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-5" aria-hidden />}
          </button>
        </div>

        {showOptions && (
          <div className="grid grid-cols-3 gap-2">
            <label className="col-span-1">
              <span className="label">{t('time')}</span>
              <input type="time" dir="ltr" className="field num px-2 font-mono text-sm" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label>
              <span className="label">{t('priority')}</span>
              <select className="field px-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{t(p)}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t('repeat')}</span>
              <select className="field px-2 text-sm" value={period} onChange={(e) => setPeriod(e.target.value as PeriodType)}>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>{t(p)}</option>
                ))}
              </select>
            </label>
          </div>
        )}
      </form>
    </section>
  );
}
