'use client';

import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, BellRing, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { setAlarmFlag } from '@/lib/alarm';
import { formatMoney } from '@/lib/currency';
import { todayDubai } from '@/lib/derived';
import { flowPaid, flowRest, summarize } from '@/lib/projects';
import { px as tx, type AnyKey } from '@/lib/ptext';
import type { Project, ProjectCashflow } from '@/lib/types';
import { FlowSheet, PaySheet, ProjectSheet } from './ProjectForms';

type K = AnyKey;

export function ProjectsPanel() {
  const { lang, notify } = useApp();
  const { projects, cashflows, projectsReady, projectsV2, rates, wallets, reservations, loadProjects } = useData();
  const T = (k: K) => tx(lang, k);
  const today = todayDubai();
  const [sheet, setSheet] = useState<Project | null | undefined>(undefined);
  const [flow, setFlow] = useState<{ p: Project; dir: 'IN' | 'OUT' } | null>(null);
  const [pay, setPay] = useState<{ p: Project; f: ProjectCashflow } | null>(null);

  /** Legacy toggle (before SQL 0007) and "undo" for spending after it. */
  async function setDone(f: ProjectCashflow, done: boolean) {
    const row = projectsV2 ? { is_done: done, paid_amount: done ? f.amount : 0 } : { is_done: done };
    const { error } = await supabase().from('project_cashflows').update(row).eq('id', f.id);
    if (error) return notify(error.message, 'error');
    await loadProjects();
  }
  async function toggleAlarm(f: ProjectCashflow) {
    if (!(await setAlarmFlag('project_cashflows', f.id, !f.alarm_enabled))) return notify(T('alarmSaveFail'), 'error');
    await loadProjects();
  }
  async function del(f: ProjectCashflow) {
    const { error } = await supabase().from('project_cashflows').delete().eq('id', f.id);
    if (error) return notify(error.message, 'error');
    await loadProjects();
  }

  if (!projectsReady) {
    return <div className="card text-center text-sm text-muted dark:text-night-muted">{T('projectsSqlMissing')}</div>;
  }

  return (
    <section className="w-full min-w-0 max-w-full space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">{T('myProjects')}</h2>
        <button type="button" className="btn btn-primary" onClick={() => setSheet(null)}>
          <Plus className="size-4" aria-hidden /> {T('addProject')}
        </button>
      </div>

      {projects.length === 0 && <div className="card py-8 text-center text-sm text-muted dark:text-night-muted">{T('noProjects')}</div>}

      {projects.map((p) => {
        const s = summarize(p, cashflows, rates, today);
        const m = (n: number) => formatMoney(n, p.currency, lang);
        const flows = cashflows.filter((f) => f.project_id === p.id);
        const ok = s.net >= 0;
        const lists: { dir: 'OUT' | 'IN'; label: K; add: K }[] = [
          { dir: 'OUT', label: 'budgetItems', add: 'addBudgetItem' },
          { dir: 'IN', label: 'inflows', add: 'addInflow' },
        ];
        return (
          <article key={p.id} className="card w-full min-w-0 max-w-full space-y-3 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold">{p.name}</h3>
                <p className="num text-xs text-muted dark:text-night-muted">
                  {m(s.spent + s.allocated)} {T('progressOf')} {m(s.totalCost)}
                </p>
              </div>
              <button type="button" aria-label={T('editProject')} className="btn border border-line p-2 dark:border-night-line" onClick={() => setSheet(p)}>
                <Pencil className="size-4" aria-hidden />
              </button>
            </div>

            <div role="progressbar" aria-valuenow={Math.round(s.pct)} aria-valuemin={0} aria-valuemax={100}
              className="h-2.5 w-full overflow-hidden rounded-full bg-paper dark:bg-night">
              <div className="flex h-full" style={{ width: `${s.pct}%` }}>
                <div className="h-full bg-emerald-600" style={{ width: s.pct > 0 ? `${(s.spentPct / s.pct) * 100}%` : '0%' }} />
                <div className="h-full flex-1 bg-brand-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              {([
                ['spentLabel', s.spent], ['remainingCost', s.remainingCost],
                ['fundsNow', s.allocated], ['pendingIn', s.pendingIn],
              ] as [K, number][]).map(([k, v]) => (
                <div key={k} className="rounded-xl bg-paper px-3 py-2 dark:bg-night">
                  <p className="text-[11px] text-muted dark:text-night-muted">{T(k)}</p>
                  <p className="num font-mono font-bold" dir="ltr">{m(v)}</p>
                </div>
              ))}
            </div>

            {flows.some((f) => f.direction === 'OUT') && (
              <p className="num text-[11px] text-muted dark:text-night-muted">
                {T('budgetItems')}: {m(s.itemsTotal)} {T('progressOf')} {m(p.budget)}
                {s.unallocatedBudget > 0 && <> · {T('unallocatedBudget')}: {m(s.unallocatedBudget)}</>}
              </p>
            )}
            {(() => {
              const mine = reservations.filter((r) => r.project_id === p.id);
              if (mine.length === 0) return null;
              const by = new Map<string, number>();
              for (const r of mine) by.set(r.wallet_id, (by.get(r.wallet_id) ?? 0) + r.amount);
              return (
                <p className="num text-[11px] text-emerald-800 dark:text-emerald-300">
                  {T('reservedInWallets')}: {[...by].map(([id, amt]) => {
                    const w = wallets.find((x) => x.id === id);
                    return `${w?.name ?? '—'} ${formatMoney(amt, w?.currency ?? p.currency, lang)}`;
                  }).join(' · ')}
                </p>
              );
            })()}

            {/* Coverage indicator: do the expected inflows cover what is left before the date? */}
            <div className={`space-y-1 rounded-xl px-3 py-2 text-sm ${ok ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-800 dark:text-rose-300'}`}>
              <p className="font-semibold">{ok ? T('coverOk') : T('coverShort')}</p>
              <p className="num text-xs" dir="ltr">
                {m(s.allocated)} + {m(s.inBefore)} ({T('beforeDate')}) {ok ? '≥' : '<'} {m(s.remainingCost)}
              </p>
              <p className="num font-mono font-bold" dir="ltr">{ok ? T('leftOver') : T('shortBy')} {m(Math.abs(s.net))}</p>
              {s.inAfter > 0 && <p className="num text-xs">{T('afterDate')}: {m(s.inAfter)}</p>}
              {s.hasDate && s.daysLeft !== null && (
                <p className="num text-xs">{p.target_date} · {s.daysLeft >= 0 ? `${s.daysLeft} ${T('daysLeft')}` : T('datePassed')}</p>
              )}
              {!s.hasDate && projectsV2 && <p className="text-xs">{T('noTargetNote')}</p>}
              {s.needed > 0 && <p className="num text-xs">{T('stillNeeded')}: {m(s.needed)}</p>}
            </div>
            {s.partial && <p className="text-[11px] text-amber-700 dark:text-amber-300">{T('noRateNote')}</p>}

            {lists.map(({ dir, label, add }) => {
              const items = flows.filter((f) => f.direction === dir);
              const Icon = dir === 'OUT' ? ArrowUpCircle : ArrowDownCircle;
              return (
                <div key={dir} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h4 className="flex items-center gap-1 text-sm font-semibold">
                      <Icon className={`size-4 ${dir === 'OUT' ? 'text-rose-600' : 'text-emerald-600'}`} aria-hidden /> {T(label)}
                    </h4>
                    <button type="button" className="text-xs font-semibold text-brand-700 dark:text-brand-400" onClick={() => setFlow({ p, dir })}>
                      + {T(add)}
                    </button>
                  </div>
                  {items.map((f) => {
                    const paid = flowPaid(f);
                    const rest = flowRest(f);
                    const done = rest <= 0;
                    const late = !done && !!f.due_date && f.due_date < today;
                    return (
                      <div key={f.id} className={`flex items-center gap-2 rounded-xl border border-line px-3 py-2 dark:border-night-line ${done ? 'opacity-70' : ''}`}>
                        {projectsV2 && !done ? (
                          <button type="button" aria-label={dir === 'IN' ? T('payIn') : T('payOut')} onClick={() => setPay({ p, f })}
                            className="grid size-6 shrink-0 place-items-center rounded-full border border-brand-500 text-brand-700 dark:text-brand-400">
                            <Plus className="size-3.5" aria-hidden />
                          </button>
                        ) : (
                          <button type="button" aria-label={done && dir === 'OUT' ? T('undo') : T('markDone')} aria-pressed={done}
                            disabled={projectsV2 && done && dir === 'IN'}
                            onClick={() => setDone(f, !done)}
                            className={`grid size-6 shrink-0 place-items-center rounded-full border ${done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line dark:border-night-line'}`}>
                            {done && <Check className="size-3.5" aria-hidden />}
                          </button>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={`truncate text-sm font-medium ${done ? 'line-through' : ''}`}>{f.title}</p>
                          <p className="num text-[11px] text-muted dark:text-night-muted">
                            {f.due_date ?? ''}
                            {late && <span className="ms-1 font-semibold text-rose-600"> · {T('overdue')}</span>}
                            {!done && paid > 0 && ` · ${T('paidWord')} ${formatMoney(paid, f.currency, lang)}`}
                          </p>
                        </div>
                        <span className="num text-end font-mono text-sm" dir="ltr">
                          {formatMoney(done ? f.amount : rest, f.currency, lang)}
                          {!done && paid > 0 && <span className="block text-[10px] text-muted dark:text-night-muted">/ {formatMoney(f.amount, f.currency, lang)}</span>}
                        </span>
                        {!done && f.due_date && (
                          <button type="button" aria-label={f.alarm_enabled ? T('alarmOn') : T('alarmOff')} aria-pressed={!!f.alarm_enabled} title={T('alarmLabel')}
                            className={`p-1 ${f.alarm_enabled ? 'text-brand-600 dark:text-brand-400' : 'text-muted dark:text-night-muted'}`} onClick={() => toggleAlarm(f)}>
                            <BellRing className={`size-4 ${f.alarm_enabled ? 'fill-current' : ''}`} aria-hidden />
                          </button>
                        )}
                        <button type="button" aria-label={T('deleteProject')} className="p-1 text-muted dark:text-night-muted" onClick={() => del(f)}>
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </article>
        );
      })}

      {sheet !== undefined && <ProjectSheet project={sheet} onClose={() => setSheet(undefined)} />}
      {flow && <FlowSheet project={flow.p} direction={flow.dir} onClose={() => setFlow(null)} />}
      {pay && <PaySheet project={pay.p} flow={pay.f} onClose={() => setPay(null)} />}
    </section>
  );
}
