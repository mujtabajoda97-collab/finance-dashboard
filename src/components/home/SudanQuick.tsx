'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUpDown, Loader2 } from 'lucide-react';
import { useApp } from '../Providers';
import { supabase } from '@/lib/supabase';
import { convert, formatMoney, formatNumber, fromAED, parseAmount, round2, toAED } from '@/lib/currency';
import { singleFlight } from '@/lib/finance';
import { tx } from '@/lib/text';
import type { Currency, RateMap, Wallet } from '@/lib/types';

const once = singleFlight();

/** Quick AED↔SDG calculator with a "confirm and deduct" button (records a SUDAN_TRANSFER). */
export function SudanQuick({ wallets, rates, onDone }: { wallets: Wallet[]; rates: RateMap; onDone: () => Promise<void> | void }) {
  const { lang, notify } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  const [raw, setRaw] = useState('');
  const [inputCur, setInputCur] = useState<Extract<Currency, 'AED' | 'SDG'>>('AED');
  const [walletId, setWalletId] = useState('');
  const [busy, setBusy] = useState(false);

  const wallet = wallets.find((w) => w.id === walletId) ?? wallets.find((w) => w.currency === 'AED') ?? wallets[0] ?? null;
  const amount = parseAmount(raw);
  const valid = raw.trim() !== '' && amount > 0;
  const hasRate = !!rates.SDG && rates.SDG > 0;

  const calc = useMemo(() => {
    if (!valid || !hasRate || !wallet) return null;
    const aed = toAED(amount, inputCur, rates);
    const sdg = aed === null ? null : fromAED(aed, 'SDG', rates);
    const walletAmt = convert(amount, inputCur, wallet.currency, rates);
    if (aed === null || sdg === null || walletAmt === null) return null;
    const lockedRate =
      wallet.currency !== inputCur && rates[inputCur] && rates[wallet.currency]
        ? (rates[inputCur] as number) / (rates[wallet.currency] as number)
        : null;
    return { aed, sdg, walletAmt: round2(walletAmt), lockedRate };
  }, [valid, hasRate, wallet, amount, inputCur, rates]);

  const insufficient = !!(calc && wallet && wallet.balance - calc.walletAmt < 0);
  const canSubmit = !!(calc && wallet && calc.walletAmt > 0 && !insufficient && !busy);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !calc || !wallet) return;
    await once(async () => {
      setBusy(true);
      const { error } = await supabase().from('transactions').insert({
        wallet_id: wallet.id,
        type: 'TRANSFER',
        category: 'SUDAN_TRANSFER',
        amount: calc.walletAmt,
        original_amount: amount,
        original_currency: inputCur,
        exchange_rate_used: calc.lockedRate,
        notes: null,
        date: new Date().toISOString(),
      });
      setBusy(false);
      if (error) return notify(error.message, 'error');
      notify(T('done'));
      if (wallet.min_balance_threshold > 0 && wallet.balance - calc.walletAmt < wallet.min_balance_threshold) {
        notify(`${T('belowMin')} — ${wallet.name}`, 'warning');
      }
      setRaw('');
      await onDone();
    });
  }

  const outCur: Currency = inputCur === 'AED' ? 'SDG' : 'AED';
  const outVal = calc ? (inputCur === 'AED' ? calc.sdg : calc.aed) : null;

  return (
    <form onSubmit={submit} className="card space-y-3" aria-labelledby="sq-title">
      <h2 id="sq-title" className="text-base font-bold">{T('quickSudan')}</h2>
      {!hasRate && <p className="text-xs text-amber-800 dark:text-amber-400">{T('noRate')}</p>}

      <label className="block">
        <span className="label">{inputCur === 'AED' ? T('enterAED') : T('enterSDG')}</span>
        <input className="field num font-mono text-lg" inputMode="decimal" dir="ltr" placeholder="0" value={raw} onChange={(e) => setRaw(e.target.value)} />
      </label>

      <div className="flex items-center justify-center">
        <button type="button" onClick={() => setInputCur((c) => (c === 'AED' ? 'SDG' : 'AED'))} className="icon-btn" aria-label={T('swap')} title={T('swap')}>
          <ArrowUpDown className="size-4" aria-hidden />
        </button>
        <ArrowDown className="mx-2 size-4 opacity-0" aria-hidden />
      </div>

      <div className="rounded-2xl bg-black/10 p-3 text-center dark:bg-black/25">
        <p className="text-xs text-muted dark:text-night-muted">{outCur === 'SDG' ? T('amountSDG') : T('amountAED')}</p>
        <p className="num mt-1 font-mono text-3xl font-bold text-amber-800 dark:text-amber-300">{outVal === null ? '—' : formatNumber(outVal, lang, 2)}</p>
      </div>

      <label className="block">
        <span className="label">{T('deductFrom')}</span>
        <select className="field" value={wallet?.id ?? ''} onChange={(e) => setWalletId(e.target.value)} aria-label={T('deductFrom')}>
          {wallets.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.currency}) — {formatNumber(w.balance, lang, 2)}</option>
          ))}
        </select>
      </label>
      {calc && wallet && (
        <p className={`num text-xs ${insufficient ? 'font-semibold text-rose-700 dark:text-rose-400' : 'text-muted dark:text-night-muted'}`}>
          {insufficient ? T('insufficient') : `−${formatMoney(calc.walletAmt, wallet.currency, lang)}`}
        </p>
      )}

      <button type="submit" disabled={!canSubmit} className="btn btn-primary w-full py-3">
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {T('confirmDeduct')}
      </button>
    </form>
  );
}
