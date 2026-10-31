'use client';

import { useState } from 'react';
import { ArrowDownCircle, ArrowUpCircle, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/currency';
import { summarize } from '@/lib/projects';
import { px as tx, type AnyKey } from '@/lib/ptext';
import type { Project, ProjectCashflow } from '@/lib/types';
import { FlowSheet, ProjectSheet } from './ProjectForms';

type K = AnyKey;

export function ProjectsPanel() {
  const { lang, notify } = useApp();
  const { projects, cashflows, projectsReady, rates, loadProjects } = useData();
  const T = (k: K) => tx(lang, k);
  const [sheet, setSheet] = useState<Project | null | undefined>(undefined);
  const [flow, setFlow] = useState<{ p: Project; dir: 'IN' | 'OUT' } | null>(null);

  async function toggle(f: ProjectCashflow) {
    const { error } = await supabase().from('project_cashflows').update({ is_done: !f.is_done }).eq('id', f.id);
    if (error) return notify(error.message, 'error');
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
        const s = summarize(p, cashflows, rates);
        const flows = cashflows.filter((f) => f.project_id === p.id);
        const lists: { dir: 'OUT' | 'IN'; label: K; add: K }[] = [
          { dir: 'OUT', label: 'outflows', add: 'addOutflow' },
          { dir: 'IN', label: 'inflows', add: 'addInflow' },
        ];
        return (
          <article key={p.id} className="card w-full min-w-0 max-w-full space-y-3 overflow-hidden">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold">{p.name}</h3>
                <p className="num text-xs text-muted dark:text-night-muted">
                  {formatMoney(p.allocated_amount, p.currency, lang)} {T('progressOf')} {formatMoney(p.budget, p.currency, lang)}
                </p>
              </div>
              <button type="button" aria-label={T('editProject')} className="btn border border-line p-2 dark:border-night-line" onClick={() => setSheet(p)}>
                <Pencil className="size-4" aria-hidden />
              </button>
            </div>

            <div role="progressbar" aria-valuenow={Math.round(s.pct)} aria-valuemin={0} aria-valuemax={100}
              className="h-2.5 w-full overflow-hidden rounded-full bg-paper dark:bg-night">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${s.pct}%` }} />
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className={`rounded-xl px-3 py-2 ${s.net >= 0 ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-300' : 'bg-rose-500/10 text-rose-800 dark:text-rose-300'}`}>
                <p className="text-[11px]">{s.net >= 0 ? T('surplus') : T('deficit')}</p>
                <p className="num font-mono font-bold" dir="ltr">{formatMoney(Math.abs(s.net), p.currency, lang)}</p>
              </div>
              <div className="rounded-xl bg-paper px-3 py-2 dark:bg-night">
                <p className="text-[11px] text-muted dark:text-night-muted">{T('stillNeeded')}</p>
                <p className="num font-mono font-bold" dir="ltr">{formatMoney(s.needed, p.currency, lang)}</p>
              </div>
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
                  {items.map((f) => (
                    <div key={f.id} className={`flex items-center gap-2 rounded-xl border border-line px-3 py-2 dark:border-night-line ${f.is_done ? 'opacity-60' : ''}`}>
                      <button type="button" aria-label={T('markDone')} aria-pressed={f.is_done} onClick={() => toggle(f)}
                        className={`grid size-6 shrink-0 place-items-center rounded-full border ${f.is_done ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-line dark:border-night-line'}`}>
                        {f.is_done && <Check className="size-3.5" aria-hidden />}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p className={`truncate text-sm font-medium ${f.is_done ? 'line-through' : ''}`}>{f.title}</p>
                        <p className="num text-[11px] text-muted dark:text-night-muted">{f.due_date ?? ''}</p>
                      </div>
                      <span className="num font-mono text-sm" dir="ltr">{formatMoney(f.amount, f.currency, lang)}</span>
                      <button type="button" aria-label={T('deleteProject')} className="p-1 text-muted dark:text-night-muted" onClick={() => del(f)}>
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              );
            })}
          </article>
        );
      })}

      {sheet !== undefined && <ProjectSheet project={sheet} onClose={() => setSheet(undefined)} />}
      {flow && <FlowSheet project={flow.p} direction={flow.dir} onClose={() => setFlow(null)} />}
    </section>
  );
}
