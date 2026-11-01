'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/paging';
import { formatMoney } from '@/lib/currency';
import { categoryLabel, donutSlices, SPEND_RANGES, spendingBreakdown, spendRange, type SpendRange } from '@/lib/spending';
import { px, type PKey } from '@/lib/ptext';
import { tx } from '@/lib/text';
import type { Txn } from '@/lib/types';

const PALETTE = ['#34c79a', '#f0b429', '#ef6b5e', '#5aa9e6', '#b184e6', '#e68fb1', '#8fd14f'];
const OTHER_COLOR = '#8b97a3';
const RANGE_KEY: Record<SpendRange, PKey> = { current: 'rangeCurrent', previous: 'rangePrevious', last3: 'rangeLast3' };

const R = 70;
const C = 2 * Math.PI * R;

/** Reports: where the money goes — donut by category, top categories, flexible month filter. */
export function SpendingBreakdown() {
  const { lang } = useApp();
  const data = useData();
  const P = (k: PKey) => px(lang, k);
  const [kind, setKind] = useState<SpendRange>('current');
  const [rows, setRows] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const { from, to } = useMemo(() => spendRange(kind), [kind]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchAllPages<unknown>(async (lo, hi) => {
          const { data: d, error: e } = await supabase()
            .from('transactions')
            .select('id,wallet_id,type,category,amount,date')
            .gte('date', from.toISOString())
            .lt('date', to.toISOString())
            .order('date', { ascending: false })
            .order('id', { ascending: false })
            .range(lo, hi);
          if (e) throw e;
          return d ?? [];
        }, 1000, 10_000);
        if (!cancelled) setRows(((res.rows ?? []) as Txn[]).map((r) => ({ ...r, amount: Number(r.amount) })));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [from, to]);

  useEffect(() => { setActive(null); }, [kind]);

  const breakdown = useMemo(() => spendingBreakdown(rows, data.allWallets, data.rates), [rows, data.allWallets, data.rates]);
  const slices = useMemo(() => donutSlices(breakdown.rows), [breakdown.rows]);
  const colorOf = (key: string) => (key === 'OTHER' ? OTHER_COLOR : PALETTE[slices.findIndex((s) => s.key === key) % PALETTE.length]);
  const money = (n: number) => formatMoney(n, 'AED', lang, 0);
  const shown = slices.find((s) => s.key === active) ?? null;
  const maxAed = breakdown.rows[0]?.aed ?? 0;

  let acc = 0;
  return (
    <section aria-labelledby="spend-title" className="space-y-3">
      <h2 id="spend-title" className="text-base font-bold">{P('spendAnalysis')}</h2>

      <div className="flex gap-2" role="tablist" aria-label={P('spendAnalysis')}>
        {SPEND_RANGES.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}
            className={`flex-1 rounded-full border px-2 py-1.5 text-xs font-semibold transition sm:text-sm ${kind === k ? 'border-brand-500 bg-brand-500 text-night' : 'border-line text-muted dark:border-night-line dark:text-night-muted'}`}>
            {P(RANGE_KEY[k])}
          </button>
        ))}
      </div>

      {error ? (
        <p className="card text-center text-sm text-rose-700 dark:text-rose-400">{tx(lang, 'error')}: {error}</p>
      ) : loading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-brand-500" aria-label={tx(lang, 'loading')} /></div>
      ) : breakdown.total === 0 ? (
        <p className="card py-10 text-center text-sm text-muted dark:text-night-muted">{tx(lang, 'noData')}</p>
      ) : (
        <>
          <div className="card">
            <p className="mb-2 text-sm font-semibold text-muted dark:text-night-muted">{P('spendByCategory')}</p>
            <div className="flex flex-col items-center gap-4">
              <div className="relative size-48">
                <svg viewBox="0 0 180 180" className="size-48" role="img" aria-label={P('spendByCategory')} onMouseLeave={() => setActive(null)}>
                  <circle cx="90" cy="90" r={R} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="26" />
                  {slices.map((s) => {
                    const frac = s.aed / breakdown.total;
                    const dash = frac * C;
                    const el = frac > 0 && (
                      <circle key={s.key} cx="90" cy="90" r={R} fill="none" stroke={colorOf(s.key)}
                        strokeWidth={active === s.key ? 32 : 26} opacity={active && active !== s.key ? 0.35 : 1}
                        strokeDasharray={`${Math.max(0, dash - 1)} ${C - Math.max(0, dash - 1)}`} strokeDashoffset={-acc * C}
                        transform="rotate(-90 90 90)" className="cursor-pointer transition-all"
                        onMouseEnter={() => setActive(s.key)} onClick={() => setActive(active === s.key ? null : s.key)}>
                        <title>{categoryLabel(lang, s.key)} · {Math.round(s.pct)}% · {money(s.aed)}</title>
                      </circle>
                    );
                    acc += frac;
                    return el;
                  })}
                </svg>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
                  <span className="max-w-full truncate text-xs text-muted dark:text-night-muted">{shown ? categoryLabel(lang, shown.key) : P('spendTotal')}</span>
                  <span className="num font-mono text-base font-bold leading-tight" dir="ltr">{money(shown ? shown.aed : breakdown.total)}</span>
                  {shown && <span className="num text-xs font-semibold">{Math.round(shown.pct)}%</span>}
                </div>
              </div>

              <ul className="w-full space-y-1.5">
                {slices.map((s) => (
                  <li key={s.key}>
                    <button type="button" onClick={() => setActive(active === s.key ? null : s.key)} aria-pressed={active === s.key}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-start text-sm transition ${active === s.key ? 'bg-brand-500/15' : ''}`}>
                      <span className="flex min-w-0 items-center gap-2 font-semibold">
                        <span className="size-3 shrink-0 rounded-full" style={{ background: colorOf(s.key) }} />
                        <span className="truncate">{categoryLabel(lang, s.key)}</span>
                      </span>
                      <span className="num shrink-0 font-mono text-xs text-muted dark:text-night-muted" dir="ltr">{Math.round(s.pct)}% · {money(s.aed)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          {breakdown.partial && <p className="text-xs text-amber-800 dark:text-amber-300">{tx(lang, 'partialNote')}</p>}

          <div className="space-y-2">
            <h3 className="text-sm font-bold">{P('topSpending')}</h3>
            <ol className="space-y-2">
              {breakdown.rows.slice(0, 10).map((r, i) => (
                <li key={r.key} className="card !p-3">
                  <div className="flex items-center gap-3">
                    <span className="num grid size-7 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-700 dark:text-brand-400">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold">{categoryLabel(lang, r.key)}</p>
                        <p className="num shrink-0 font-mono text-sm font-bold" dir="ltr">{money(r.aed)}</p>
                      </div>
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-paper dark:bg-night">
                        <div className="h-full rounded-full" style={{ width: `${maxAed > 0 ? (r.aed / maxAed) * 100 : 0}%`, background: colorOf(slices.some((s) => s.key === r.key) ? r.key : 'OTHER') }} />
                      </div>
                      <p className="num mt-1 text-[11px] text-muted dark:text-night-muted">{Math.round(r.pct)}% · {r.n} {P('opsCount')}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <p className="text-[11px] text-muted dark:text-night-muted">{P('spendNote')}</p>
        </>
      )}
    </section>
  );
}
