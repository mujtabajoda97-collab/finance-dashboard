'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Pencil } from 'lucide-react';
import { useApp } from '../Providers';
import { supabase } from '@/lib/supabase';
import { parseAmount } from '@/lib/currency';
import { tx } from '@/lib/text';
import type { ExchangeRate } from '@/lib/types';

/** Slim bar: "سعر اليوم: 1 AED = 680 SDG ✎" — tap the pencil, type, save. */
export function RateStrip({ userId, rateRows, onSaved }: { userId: string; rateRows: ExchangeRate[]; onSaved: () => Promise<void> | void }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const sdg = rateRows.find((r) => r.base_currency === 'AED' && r.target_currency === 'SDG');
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setValue(sdg ? String(sdg.rate) : ''), [sdg?.rate]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseAmount(value);
  const dirty = value !== '' && parsed > 0 && parsed !== sdg?.rate;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    const { error } = await supabase()
      .from('exchange_rates')
      .upsert({ user_id: userId, base_currency: 'AED', target_currency: 'SDG', rate: parsed }, { onConflict: 'user_id,base_currency,target_currency' });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(T('saved'));
    setEditing(false);
    await onSaved();
  }

  return (
    <form onSubmit={save} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-card px-4 py-2.5 text-sm dark:border-night-line dark:bg-[#0c241d]">
      <Link href="/rates/" className="font-semibold text-muted underline-offset-2 hover:underline dark:text-night-muted">{T('todayRateLine')}:</Link>
      <div className="flex items-center gap-2">
        <span className="num font-mono opacity-80">1 AED =</span>
        {editing ? (
          <input
            autoFocus
            aria-label="AED → SDG"
            inputMode="decimal"
            dir="ltr"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="num w-24 rounded-lg border border-brand-500/60 bg-transparent px-2 py-1 font-mono font-semibold outline-none"
          />
        ) : (
          <span className="num font-mono text-base font-bold">{sdg ? sdg.rate : '—'}</span>
        )}
        <span className="num font-mono opacity-80">SDG</span>
        {editing ? (
          <button type="submit" disabled={!dirty || busy} className="inline-flex size-8 items-center justify-center rounded-lg bg-brand-500 text-night disabled:opacity-30" aria-label={T('save')}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
          </button>
        ) : (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex size-8 items-center justify-center rounded-lg text-muted hover:bg-white/5 dark:text-night-muted" aria-label={T('updateRate')}>
            <Pencil className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </form>
  );
}
