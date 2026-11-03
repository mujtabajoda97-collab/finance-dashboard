'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { fetchAllPages } from '@/lib/paging';
import { formatMoney, toAED } from '@/lib/currency';
import { startOfMonthDubai, APP_TZ, intlLocale } from '@/lib/time';
import { startOfWeekDubai } from '@/lib/derived';
import { tx } from '@/lib/text';
import { SpendingBreakdown } from '@/components/reports/SpendingBreakdown';
import { SafeBoundary } from '@/components/SafeBoundary';
import type { Txn } from '@/lib/types';
import { PdfButton } from '@/components/PdfButton';
import type { PdfDoc } from '@/lib/pdf';

type Period = 'weekly' | 'monthly' | 'yearly';
const DAY = 86_400_000;
const OFFSET = 4 * 3600_000;
const COMMIT = new Set(['DEBT', 'BILLS', 'RENT']);
const COLORS = { sudan: '#34c79a', daily: '#f0b429', commit: '#ef6b5e' };

function rangeFor(period: Period, offset: number): { from: Date; to: Date } {
  const now = new Date();
  if (period === 'monthly') return { from: startOfMonthDubai(now, offset), to: startOfMonthDubai(now, offset + 1) };
  if (period === 'weekly') {
    const from = new Date(startOfWeekDubai(now).getTime() + offset * 7 * DAY);
    return { from, to: new Date(from.getTime() + 7 * DAY) };
  }
  const y = new Date(now.getTime() + OFFSET).getUTCFullYear() + offset;
  return { from: new Date(Date.UTC(y, 0, 1) - OFFSET), to: new Date(Date.UTC(y + 1, 0, 1) - OFFSET) };
}

export default function ReportsPage() {
  const { lang } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const data = useData();
  const [period, setPeriod] = useState<Period>('monthly');
  const [offset, setOffset] = useState(0);
  const [rows, setRows] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { from, to } = useMemo(() => rangeFor(period, offset), [period, offset]);

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

  const stats = useMemo(() => {
    const byId = new Map(data.allWallets.map((w) => [w.id, w]));
    let sudan = 0, daily = 0, commit = 0, partial = false;
    for (const t of rows) {
      const isSudan = t.type === 'TRANSFER' && t.category === 'SUDAN_TRANSFER';
      if (!(t.type === 'EXPENSE' || isSudan)) continue; // income and internal transfers are not spending
      const w = byId.get(t.wallet_id);
      const aed = w ? toAED(t.amount, w.currency, data.rates) : null;
      if (aed === null) { partial = true; continue; }
      if (isSudan) sudan += aed;
      else if (t.category && COMMIT.has(t.category)) commit += aed;
      else daily += aed;
    }
    const total = sudan + daily + commit;
    let left = 0;
    for (const w of data.wallets) { const v = toAED(w.balance, w.currency, data.rates); if (v !== null) left += v; }
    return { sudan, daily, commit, total, left, partial };
  }, [rows, data.allWallets, data.wallets, data.rates]);

  const label = useMemo(() => {
    const loc = intlLocale(lang);
    if (period === 'monthly') return new Intl.DateTimeFormat(loc, { timeZone: APP_TZ, month: 'long', year: 'numeric' }).format(from);
    if (period === 'yearly') return new Intl.DateTimeFormat(loc, { timeZone: APP_TZ, year: 'numeric' }).format(from);
    const f = new Intl.DateTimeFormat(loc, { timeZone: APP_TZ, day: 'numeric', month: 'short' });
    return `${f.format(from)} – ${f.format(new Date(to.getTime() - 1))}`;
  }, [period, from, to, lang]);

  const parts = [
    { key: 'sudan', label: T('sudanTransfers'), v: stats.sudan, color: COLORS.sudan },
    { key: 'daily', label: T('dailyExpenses'), v: stats.daily, color: COLORS.daily },
    { key: 'commit', label: T('commitments'), v: stats.commit, color: COLORS.commit },
  ];
  const R = 70, C = 2 * Math.PI * R;
  let acc = 0;

  const buildDoc = (): PdfDoc => ({
    title: lang === 'ar' ? 'تقرير المصروفات' : 'Spending report',
    subtitle: label,
    sections: [
      {
        heading: lang === 'ar' ? 'ملخص الفترة (بالدرهم)' : 'Period summary (AED)',
        head: lang === 'ar' ? ['البند', 'المبلغ'] : ['Item', 'Amount'],
        rows: [
          ...parts.map((p) => [p.label, formatMoney(p.v, 'AED', lang)]),
          [lang === 'ar' ? 'الإجمالي' : 'Total', formatMoney(stats.total, 'AED', lang)],
          [lang === 'ar' ? 'المتبقي في المحافظ' : 'Left in wallets', formatMoney(stats.left, 'AED', lang)],
        ],
        note: stats.partial ? T('partialNote') : undefined,
      },
    ],
    footer: 'My Life OS',
  });

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-6">
      <div className="flex justify-end"><PdfButton build={buildDoc} fileName="report.pdf" /></div>
      <div className="flex gap-2" role="tablist" aria-label={T('reports')}>
        {(['yearly', 'monthly', 'weekly'] as Period[]).map((p) => (
          <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => { setPeriod(p); setOffset(0); }}
            className={`flex-1 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${period === p ? 'border-brand-500 bg-brand-500 text-night' : 'border-line text-muted dark:border-night-line dark:text-night-muted'}`}>
            {T(p)}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <button type="button" className="icon-btn" onClick={() => setOffset((o) => o - 1)} aria-label="‹"><ChevronRight className="size-4 ltr:hidden" aria-hidden /><ChevronLeft className="size-4 rtl:hidden" aria-hidden /></button>
        <p className="text-lg font-bold">{label}</p>
        <button type="button" className="icon-btn disabled:opacity-30" disabled={offset >= 0} onClick={() => setOffset((o) => o + 1)} aria-label="›"><ChevronLeft className="size-4 ltr:hidden" aria-hidden /><ChevronRight className="size-4 rtl:hidden" aria-hidden /></button>
      </div>

      {error ? (
        <p className="card text-center text-sm text-rose-700 dark:text-rose-400">{T('error')}: {error}</p>
      ) : loading ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-brand-500" aria-label={T('loading')} /></div>
      ) : (
        <>
          <div className="card">
            {stats.total === 0 ? (
              <p className="py-10 text-center text-sm text-muted dark:text-night-muted">{T('noData')}</p>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <svg viewBox="0 0 180 180" className="size-44" role="img" aria-label={T('reports')}>
                  <circle cx="90" cy="90" r={R} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="26" />
                  {parts.map((p) => {
                    const frac = p.v / stats.total;
                    const dash = frac * C;
                    const el = frac > 0 && (
                      <circle key={p.key} cx="90" cy="90" r={R} fill="none" stroke={p.color} strokeWidth="26"
                        strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc * C} transform="rotate(-90 90 90)" />
                    );
                    acc += frac;
                    return el;
                  })}
                </svg>
                <ul className="w-full space-y-2">
                  {parts.map((p) => (
                    <li key={p.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="flex items-center gap-2 font-semibold"><span className="size-3 rounded-full" style={{ background: p.color }} />{p.label}</span>
                      <span className="num font-mono text-xs text-muted dark:text-night-muted">{Math.round((p.v / stats.total) * 100)}% · {formatMoney(p.v, 'AED', lang, 0)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          {stats.partial && <p className="text-xs text-amber-800 dark:text-amber-300">{T('partialNote')}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-rose-400/40 bg-gradient-to-br from-rose-500/30 to-rose-900/10 p-3.5">
              <p className="text-sm font-semibold">{T('totalSpent')}</p>
              <p className="num mt-1 font-mono text-xl font-bold text-rose-700 dark:text-rose-200">{formatMoney(stats.total, 'AED', lang, 0)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-400/40 bg-gradient-to-br from-emerald-500/30 to-emerald-900/10 p-3.5">
              <p className="text-sm font-semibold">{T('leftInWallets')}</p>
              <p className="num mt-1 font-mono text-xl font-bold text-emerald-700 dark:text-emerald-200">{formatMoney(stats.left, 'AED', lang, 0)}</p>
            </div>
          </div>
        </>
      )}
      <SafeBoundary><SpendingBreakdown /></SafeBoundary>
    </div>
  );
}
