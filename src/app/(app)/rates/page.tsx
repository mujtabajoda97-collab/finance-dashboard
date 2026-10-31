'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { useData } from '@/lib/data';
import { supabase } from '@/lib/supabase';
import { convert, formatNumber, parseAmount, round2 } from '@/lib/currency';
import { APP_TZ, intlLocale } from '@/lib/time';
import { tx } from '@/lib/text';
import type { Currency } from '@/lib/types';

const CURS: Currency[] = ['AED', 'USD', 'SDG'];

export default function RatesPage() {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const data = useData();
  const sdg = data.rateRows.find((r) => r.base_currency === 'AED' && r.target_currency === 'SDG');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [vals, setVals] = useState<Record<Currency, string>>({ AED: '', USD: '', SDG: '' });

  useEffect(() => setValue(sdg ? String(sdg.rate) : ''), [sdg?.rate]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseAmount(value);
  const dirty = value !== '' && parsed > 0 && parsed !== sdg?.rate;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    const { error } = await supabase()
      .from('exchange_rates')
      .upsert({ user_id: data.userId, base_currency: 'AED', target_currency: 'SDG', rate: parsed }, { onConflict: 'user_id,base_currency,target_currency' });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(T('saved'));
    await Promise.all([data.loadRates(), data.loadRateHistory(), data.loadAlerts()]);
  }

  // Typing in any box fills the other two instantly.
  function onType(from: Currency, raw: string) {
    const n = parseAmount(raw);
    const next: Record<Currency, string> = { AED: '', USD: '', SDG: '' };
    next[from] = raw;
    if (raw.trim() !== '' && n > 0) {
      for (const c of CURS) {
        if (c === from) continue;
        const v = convert(n, from, c, data.rates);
        next[c] = v === null ? '' : String(round2(v));
      }
    }
    setVals(next);
  }

  const updatedAt = sdg?.updated_at
    ? new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(sdg.updated_at))
    : null;

  // 7-day chart (AED → SDG), from exchange_rate_history; the current rate closes the line.
  const pts = useMemo(() => {
    const base = data.rateHistory.map((p) => ({ t: new Date(p.recorded_at).getTime(), v: p.rate }));
    if (sdg && (base.length === 0 || base[base.length - 1].v !== sdg.rate)) base.push({ t: Date.now(), v: sdg.rate });
    return base;
  }, [data.rateHistory, sdg]);

  const W = 320, H = 120, PAD = 8;
  const chart = useMemo(() => {
    if (pts.length < 2) return null;
    const tMin = Date.now() - 7 * 86_400_000, tMax = Date.now();
    const vs = pts.map((p) => p.v);
    const lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
    const x = (t: number) => PAD + ((Math.max(t, tMin) - tMin) / (tMax - tMin)) * (W - 2 * PAD);
    const y = (v: number) => H - PAD - ((v - lo) / span) * (H - 2 * PAD);
    const line = pts.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${x(pts[0].t).toFixed(1)},${H - PAD} ${line} ${x(pts[pts.length - 1].t).toFixed(1)},${H - PAD}`;
    return { line, area, lo, hi };
  }, [pts]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 pb-6">
      <form onSubmit={save} className="card space-y-3 border-emerald-400/30">
        <h2 className="text-base font-bold">{T('rateToday')}</h2>
        <div className="flex items-center gap-2">
          <span className="num font-mono text-base opacity-80">1 AED =</span>
          <input aria-label="AED → SDG" className="field num min-w-0 flex-1 font-mono text-lg font-bold" inputMode="decimal" dir="ltr" value={value} onChange={(e) => setValue(e.target.value)} />
          <span className="num font-mono text-base opacity-80">SDG</span>
        </div>
        <button type="submit" disabled={!dirty || busy} className="btn btn-primary w-full py-3">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />} {T('updateRate')}
        </button>
        {updatedAt && <p className="num text-xs text-muted dark:text-night-muted">{T('lastUpdate')}: {updatedAt}</p>}
      </form>

      <section className="card space-y-3" aria-labelledby="calc-title">
        <h2 id="calc-title" className="text-base font-bold">{T('quickCalc')}</h2>
        {CURS.map((c) => (
          <label key={c} className="flex items-center gap-2">
            <span className="num w-12 shrink-0 font-mono text-sm font-bold">{c}</span>
            <input className="field num font-mono text-lg" inputMode="decimal" dir="ltr" placeholder="0" aria-label={c} value={vals[c]} onChange={(e) => onType(c, e.target.value)} />
          </label>
        ))}
        {!data.rates.SDG && <p className="text-xs text-amber-800 dark:text-amber-300">{T('noRate')}</p>}
      </section>

      <section className="card" aria-labelledby="trend-title">
        <h2 id="trend-title" className="mb-2 text-base font-bold">{T('rateTrend')}</h2>
        {chart ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={T('rateTrend')}>
              <polygon points={chart.area} fill="rgba(240,180,41,0.18)" />
              <polyline points={chart.line} fill="none" stroke="#f0b429" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            </svg>
            <div className="num mt-1 flex justify-between font-mono text-xs text-muted dark:text-night-muted">
              <span>{formatNumber(chart.lo, lang, 2)}</span><span>{formatNumber(chart.hi, lang, 2)}</span>
            </div>
          </>
        ) : (
          <p className="py-6 text-center text-sm text-muted dark:text-night-muted">{T('trendEmpty')}</p>
        )}
      </section>
    </div>
  );
}
