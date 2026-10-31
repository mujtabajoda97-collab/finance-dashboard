'use client';

import Link from 'next/link';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { formatMoney } from '@/lib/currency';
import { summarize } from '@/lib/projects';
import { px as tx, type AnyKey } from '@/lib/ptext';

/** Summary card for the home page. Hidden until the projects tables exist and at least one project is saved. */
export function HomeProjects() {
  const { lang } = useApp();
  const { projects, cashflows, projectsReady, rates } = useData();
  const T = (k: AnyKey) => tx(lang, k);
  if (!projectsReady) return null;
  const top = projects.slice(0, 3);

  return (
    <section className="card !p-3" aria-label={T('myProjects')}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-base font-bold">{T('myProjects')}</h2>
        <Link href="/finance/?tab=projects" className="text-xs font-semibold text-brand-700 dark:text-brand-400">{T('viewAll')}</Link>
      </div>
      {top.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted dark:text-night-muted">{T('noProjects')}</p>
      ) : (
        <ul className="space-y-3">
          {top.map((p) => {
            const s = summarize(p, cashflows, rates);
            return (
              <li key={p.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className={`num font-mono text-xs ${s.net >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`} dir="ltr">
                    {s.net >= 0 ? '+' : '−'}{formatMoney(Math.abs(s.net), p.currency, lang, 0)}
                  </p>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper dark:bg-night">
                  <div className="h-full rounded-full bg-brand-500" style={{ width: `${s.pct}%` }} />
                </div>
                <p className="num mt-0.5 text-[11px] text-muted dark:text-night-muted">
                  {formatMoney(p.allocated_amount, p.currency, lang, 0)} {T('progressOf')} {formatMoney(p.budget, p.currency, lang, 0)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
