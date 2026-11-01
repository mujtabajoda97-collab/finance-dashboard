'use client';

import { useEffect, useState } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useApp } from '../Providers';
import { supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/currency';
import { APP_TZ, intlLocale } from '@/lib/time';
import { px } from '@/lib/ptext';
import type { Debt } from '@/lib/types';

interface Entry {
  id: string;
  kind: 'PAYMENT' | 'INCREASE';
  amount: number;
  at: string;
  note?: string | null;
  totalAfter?: number;
}

/** Chronological history of a debt: instalments and increases. Increases appear once SQL 0009 is applied. */
export function DebtHistory({ debt, version }: { debt: Debt; version: string }) {
  const { lang } = useApp();
  const P = (k: Parameters<typeof px>[1]) => px(lang, k);
  const [entries, setEntries] = useState<Entry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = supabase();
      const [pay, ev] = await Promise.all([
        sb.from('debt_payments').select('id,amount,payment_date,notes').eq('debt_id', debt.id).order('payment_date', { ascending: false }).limit(200),
        sb.from('debt_events').select('id,amount,created_at,note,total_after').eq('debt_id', debt.id).order('created_at', { ascending: false }).limit(200),
      ]);
      if (cancelled) return;
      const out: Entry[] = [];
      for (const r of (pay.data ?? []) as { id: string; amount: number | string; payment_date: string; notes: string | null }[]) {
        out.push({ id: `p-${r.id}`, kind: 'PAYMENT', amount: Number(r.amount), at: r.payment_date, note: r.notes });
      }
      // debt_events does not exist until SQL 0009 is applied: ev.error is ignored (fail-soft)
      for (const r of (ev.data ?? []) as { id: string; amount: number | string; created_at: string; note: string | null; total_after: number | string }[]) {
        out.push({ id: `e-${r.id}`, kind: 'INCREASE', amount: Number(r.amount), at: r.created_at, note: r.note, totalAfter: Number(r.total_after) });
      }
      out.sort((a, b) => b.at.localeCompare(a.at));
      setEntries(out);
    })();
    return () => { cancelled = true; };
  }, [debt.id, version]);

  const fmt = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold">{P('debtHistory')}</p>
      {entries === null ? null : entries.length === 0 ? (
        <p className="text-xs text-muted dark:text-night-muted">{P('historyEmpty')}</p>
      ) : (
        <ul className="space-y-1.5">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-xs dark:border-night-line">
              {e.kind === 'INCREASE'
                ? <ArrowUpRight className="size-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                : <ArrowDownRight className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />}
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{e.kind === 'INCREASE' ? P('histIncrease') : P('histPayment')}{e.note ? ` · ${e.note}` : ''}</p>
                <p className="num text-muted dark:text-night-muted">
                  {fmt.format(new Date(e.at))}
                  {e.totalAfter !== undefined && ` · ${P('histTotal')}: ${formatMoney(e.totalAfter, debt.currency, lang)}`}
                </p>
              </div>
              <span className={`num shrink-0 font-mono font-bold ${e.kind === 'INCREASE' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}`} dir="ltr">
                {e.kind === 'INCREASE' ? '+' : '−'}{formatMoney(e.amount, debt.currency, lang)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
