'use client';

import Link from 'next/link';
import { AlertTriangle, Clock } from 'lucide-react';
import { useApp } from '../Providers';
import { formatMoney } from '@/lib/currency';
import { remaining } from '@/lib/debt';
import { isDebtOverdue, isOpenDebt, isTaskOverdue } from '@/lib/derived';
import { endOfDayDubai, APP_TZ, intlLocale } from '@/lib/time';
import { tx } from '@/lib/text';
import { PriorityBadge } from '../tasks/PriorityBadge';
import type { Debt, Task } from '@/lib/types';

/** Compact block: nearest debts due + the most important tasks of today. */
export function DueAndTasks({ debts, tasks }: { debts: Debt[]; tasks: Task[] }) {
  const { lang } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const endToday = endOfDayDubai().getTime();
  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  const topTasks = tasks
    .filter((t) => isTaskOverdue(t) || (t.due_date && new Date(t.due_date).getTime() <= endToday))
    .sort((a, b) => rank[a.priority] - rank[b.priority] || (a.due_date ?? '').localeCompare(b.due_date ?? ''))
    .slice(0, 3);
  const nearest = debts.filter((d) => isOpenDebt(d) && d.due_date).slice(0, 2);
  const timeFmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, hour: '2-digit', minute: '2-digit' });

  return (
    <section className="space-y-3" aria-label={T('dueAndTasks')}>
      <h2 className="text-base font-bold">{T('dueAndTasks')}</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="card !p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">{T('nearestDebts')}</h3>
            <Link href="/debts/" className="text-xs font-semibold text-brand-700 dark:text-brand-400">{T('viewAll')}</Link>
          </div>
          {nearest.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted dark:text-night-muted">{T('noDue')}</p>
          ) : (
            <ul className="space-y-2">
              {nearest.map((d) => {
                const late = isDebtOverdue(d);
                return (
                  <li key={d.id} className={`rounded-xl border px-3 py-2 ${late ? 'border-rose-400/40 bg-rose-500/10' : 'border-line dark:border-night-line'}`}>
                    <p className="truncate text-sm font-semibold">{d.person_name}</p>
                    <p className={`num font-mono text-sm ${d.type === 'RECEIVABLE' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>{formatMoney(remaining(d.total_amount, d.paid_amount), d.currency, lang)}</p>
                    <p className={`num flex items-center gap-1 text-[11px] ${late ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-muted dark:text-night-muted'}`}>
                      {late && <AlertTriangle className="size-3" aria-hidden />}{d.due_date}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="card !p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-bold">{T('todayTasks')}</h3>
            <Link href="/tasks/" className="text-xs font-semibold text-brand-700 dark:text-brand-400">{T('viewAll')}</Link>
          </div>
          {topTasks.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted dark:text-night-muted">{T('noTasksToday')}</p>
          ) : (
            <ul className="space-y-2">
              {topTasks.map((t) => (
                <li key={t.id} className="rounded-xl border border-line px-3 py-2 dark:border-night-line">
                  <p className="truncate text-sm font-semibold">{t.title}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <PriorityBadge priority={t.priority} />
                    {t.due_date && (
                      <span className={`num flex items-center gap-1 font-mono text-[11px] ${isTaskOverdue(t) ? 'font-semibold text-rose-700 dark:text-rose-300' : 'text-muted dark:text-night-muted'}`}>
                        <Clock className="size-3" aria-hidden />{timeFmt.format(new Date(t.due_date))}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
