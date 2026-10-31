'use client';

import { useEffect, useState } from 'react';
import { ArrowLeftRight, Check, Loader2 } from 'lucide-react';
import { useApp } from './Providers';
import { APP_TZ, intlLocale } from '@/lib/time';
import { supabase } from '@/lib/supabase';
import { formatNumber, parseAmount } from '@/lib/currency';
import type { Currency, ExchangeRate } from '@/lib/types';

interface Props {
  userId: string;
  rateRows: ExchangeRate[];
  onSaved: () => Promise<void> | void;
}

function findRate(rows: ExchangeRate[], target: Currency) {
  return rows.find((r) => r.base_currency === 'AED' && r.target_currency === target);
}

/** Sticky strip: "1 AED = [ X ] SDG" — editable in place, plus the USD rate. */
export function RateBar({ userId, rateRows, onSaved }: Props) {
  const { t, lang, notify } = useApp();
  const sdg = findRate(rateRows, 'SDG');
  const usd = findRate(rateRows, 'USD');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValue(sdg ? String(sdg.rate) : '');
  }, [sdg?.rate]); // eslint-disable-line react-hooks/exhaustive-deps

  const parsed = parseAmount(value);
  const dirty = value !== '' && parsed > 0 && parsed !== sdg?.rate;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    const { error } = await supabase()
      .from('exchange_rates')
      .upsert(
        { user_id: userId, base_currency: 'AED', target_currency: 'SDG', rate: parsed },
        { onConflict: 'user_id,base_currency,target_currency' },
      );
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(t('saved'));
    await onSaved();
  }

  const updatedAt = sdg?.updated_at
    ? new Intl.DateTimeFormat(intlLocale(lang), {
        timeZone: APP_TZ,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(sdg.updated_at))
    : null;

  return (
    <form
      onSubmit={save}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-3xl bg-brand-900 px-4 py-3 text-brand-50 shadow-sm dark:bg-brand-900/60"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ArrowLeftRight className="size-4 opacity-70" aria-hidden />
        {t('todayRate')}
      </div>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="num shrink-0 font-mono text-sm opacity-80">1 AED =</span>
        <input
          aria-label="AED → SDG"
          inputMode="decimal"
          dir="ltr"
          placeholder={t('ratePlaceholder')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="num w-28 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 py-1.5 font-mono text-base font-semibold text-white outline-none placeholder:text-white/40 focus:border-brand-400 sm:max-w-36"
        />
        <span className="num shrink-0 font-mono text-sm opacity-80">SDG</span>
        <button
          type="submit"
          disabled={!dirty || busy}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-400 text-brand-900 transition disabled:opacity-30"
          aria-label={t('save')}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
        </button>
      </div>

      <div className="flex w-full items-center justify-between gap-3 text-xs opacity-70 sm:w-auto">
        {usd && <span className="num font-mono">1 USD = {formatNumber(1 / usd.rate, lang, 4)} AED</span>}
        {updatedAt && (
          <span>
            {t('updated')}: <span className="num">{updatedAt}</span>
          </span>
        )}
      </div>
    </form>
  );
}
