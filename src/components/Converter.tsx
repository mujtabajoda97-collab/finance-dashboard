'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, Loader2, Lock, Send } from 'lucide-react';
import { useApp } from './Providers';
import { supabase } from '@/lib/supabase';
import { convert, formatMoney, formatNumber, parseAmount, round2, toAED, fromAED } from '@/lib/currency';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES, type DictKey } from '@/lib/i18n';
import { CURRENCIES, type Currency, type RateMap, type TxnType, type Wallet } from '@/lib/types';

interface Props {
  wallets: Wallet[];
  rates: RateMap;
  onDone: () => Promise<void> | void;
  initialKind?: Extract<TxnType, 'TRANSFER' | 'EXPENSE' | 'INCOME'>;
  /** Rendered inside a sheet: no card chrome or visible title. */
  embedded?: boolean;
}

type Kind = Extract<TxnType, 'TRANSFER' | 'EXPENSE' | 'INCOME'>;

export function Converter({ wallets, rates, onDone, initialKind = 'TRANSFER', embedded = false }: Props) {
  const { t, lang, notify } = useApp();
  const [kind, setKind] = useState<Kind>(initialKind);
  const [inputCur, setInputCur] = useState<Currency>(initialKind === 'TRANSFER' ? 'SDG' : 'AED');
  const [raw, setRaw] = useState('');
  const [walletId, setWalletId] = useState('');
  const [category, setCategory] = useState(initialKind === 'INCOME' ? 'SALARY' : 'GENERAL');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  // Default to the first AED wallet (or the first wallet).
  useEffect(() => {
    if (!wallets.find((w) => w.id === walletId)) {
      setWalletId((wallets.find((w) => w.currency === 'AED') ?? wallets[0])?.id ?? '');
    }
  }, [wallets, walletId]);

  function switchKind(k: Kind) {
    setKind(k);
    setCategory(k === 'INCOME' ? 'SALARY' : 'GENERAL');
    if (k === 'TRANSFER') setInputCur('SDG');
  }

  const wallet = wallets.find((w) => w.id === walletId) ?? null;
  const amount = parseAmount(raw);
  const valid = raw.trim() !== '' && amount > 0;

  const calc = useMemo(() => {
    if (!valid) return null;
    const aed = toAED(amount, inputCur, rates);
    const sdg = aed === null ? null : fromAED(aed, 'SDG', rates);
    const walletAmt = wallet ? convert(amount, inputCur, wallet.currency, rates) : null;
    const sign = kind === 'INCOME' ? 1 : -1;
    const after = wallet && walletAmt !== null ? wallet.balance + sign * round2(walletAmt) : null;
    // "1 <wallet currency> = X <input currency>", only meaningful when they differ.
    const lockedRate =
      wallet && wallet.currency !== inputCur && rates[inputCur] && rates[wallet.currency]
        ? (rates[inputCur] as number) / (rates[wallet.currency] as number)
        : null;
    return { aed, sdg, walletAmt: walletAmt === null ? null : round2(walletAmt), after, lockedRate };
  }, [valid, amount, inputCur, rates, wallet, kind]);

  const needsSdgRate = !rates.SDG && (inputCur === 'SDG' || wallet?.currency === 'SDG' || kind === 'TRANSFER');
  const insufficient = kind !== 'INCOME' && calc?.after != null && calc.after < 0;
  const dropsBelowMin =
    kind !== 'INCOME' &&
    wallet &&
    wallet.min_balance_threshold > 0 &&
    calc?.after != null &&
    calc.after >= 0 &&
    calc.after < wallet.min_balance_threshold;

  const canSubmit = valid && wallet && calc?.walletAmt && calc.walletAmt > 0 && !insufficient && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || !wallet || !calc?.walletAmt) return;
    setBusy(true);
    const { error } = await supabase()
      .from('transactions')
      .insert({
        wallet_id: wallet.id,
        type: kind,
        category: kind === 'TRANSFER' ? 'SUDAN_TRANSFER' : category,
        amount: calc.walletAmt,
        original_amount: amount,
        original_currency: inputCur,
        exchange_rate_used: calc.lockedRate,
        notes: notes.trim() || null,
        date: new Date().toISOString(),
      });
    setBusy(false);
    if (error) return notify(error.message, 'error');
    notify(t('done'));
    if (dropsBelowMin) notify(`${t('lowAfter')} — ${wallet.name}`, 'warning');
    setRaw('');
    setNotes('');
    await onDone();
  }

  const categories = kind === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const confirmLabel = kind === 'TRANSFER' ? t('confirmTransfer') : kind === 'EXPENSE' ? t('confirmExpense') : t('confirmIncome');

  return (
    <section className={embedded ? '' : 'card'} aria-labelledby="converter-title">
      <h2 id="converter-title" className={embedded ? 'sr-only' : 'mb-3 text-base font-bold'}>{t('converter')}</h2>

      <div className="segmented mb-4" role="group">
        {(['TRANSFER', 'EXPENSE', 'INCOME'] as Kind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => switchKind(k)}>
            {k === 'TRANSFER' ? t('kindTransfer') : k === 'EXPENSE' ? t('kindExpense') : t('kindIncome')}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {/* Amount + currency */}
        <div>
          <label htmlFor="cv-amount" className="label">{t('amount')}</label>
          <div className="flex items-stretch gap-2">
            <input
              id="cv-amount"
              inputMode="decimal"
              dir="ltr"
              autoComplete="off"
              placeholder="0"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              className="field num min-w-0 flex-1 font-mono text-xl font-semibold"
            />
            <div className="segmented shrink-0" role="group" aria-label={t('currency')}>
              {CURRENCIES.map((c) => (
                <button key={c} type="button" aria-pressed={inputCur === c} onClick={() => setInputCur(c)} className="px-2.5 font-mono text-xs">
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Live conversion */}
        {needsSdgRate ? (
          <p className="rounded-2xl bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            {t('rateMissing')}
          </p>
        ) : (
          calc && (
            <div className="rounded-2xl bg-brand-50 px-4 py-3 dark:bg-brand-900/30">
              <div className="flex items-center gap-2 text-brand-700 dark:text-brand-400">
                <ArrowDown className="size-4 shrink-0" aria-hidden />
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {inputCur !== 'AED' && calc.aed !== null && (
                    <span className="text-sm">
                      {t('equals')} <strong className="num font-mono text-base">{formatMoney(calc.aed, 'AED', lang)}</strong>
                    </span>
                  )}
                  {inputCur !== 'SDG' && calc.sdg !== null && (
                    <span className="text-sm">
                      {kind === 'TRANSFER' ? t('willArrive') : '≈'}{' '}
                      <strong className="num font-mono text-base">{formatMoney(calc.sdg, 'SDG', lang, 0)}</strong>
                    </span>
                  )}
                </div>
              </div>
              {calc.lockedRate && (
                <p className="mt-1.5 flex items-center gap-1.5 text-xs text-brand-700/80 dark:text-brand-400/80">
                  <Lock className="size-3" aria-hidden />
                  {t('rateLocked')}{' '}
                  <span className="num font-mono">
                    1 {wallet?.currency} = {formatNumber(calc.lockedRate, lang, 4)} {inputCur}
                  </span>
                </p>
              )}
            </div>
          )
        )}

        {/* Wallet */}
        <div>
          <label htmlFor="cv-wallet" className="label">{kind === 'INCOME' ? t('toWallet') : t('fromWallet')}</label>
          <select id="cv-wallet" className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)} disabled={!wallets.length}>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} — {formatMoney(w.balance, w.currency, lang)}
              </option>
            ))}
          </select>
          {wallet && calc?.walletAmt != null && calc.after != null && (
            <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
              <span className={kind === 'INCOME' ? 'text-brand-700 dark:text-brand-400' : 'text-rose-600 dark:text-rose-300'}>
                {kind === 'INCOME' ? t('willAdd') : t('willDeduct')}:{' '}
                <strong className="num font-mono">{formatMoney(calc.walletAmt, wallet.currency, lang)}</strong>
              </span>
              <span className="text-muted dark:text-night-muted">
                {t('balanceAfter')}:{' '}
                <strong className={`num font-mono ${insufficient ? 'text-rose-600' : dropsBelowMin ? 'text-amber-600' : ''}`}>
                  {formatMoney(calc.after, wallet.currency, lang)}
                </strong>
              </span>
            </div>
          )}
          {insufficient && <p className="mt-1 text-xs font-semibold text-rose-600">{t('insufficient')}</p>}
          {dropsBelowMin && <p className="mt-1 text-xs font-semibold text-amber-600">{t('lowAfter')}</p>}
        </div>

        {/* Category (expense / income only) */}
        {kind !== 'TRANSFER' && (
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('category')}>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold text-muted transition aria-pressed:border-brand-500 aria-pressed:bg-brand-50 aria-pressed:text-brand-700 dark:border-night-line dark:text-night-muted dark:aria-pressed:bg-brand-900/40 dark:aria-pressed:text-brand-400"
              >
                {t(`cat_${c}` as DictKey)}
              </button>
            ))}
          </div>
        )}

        <input aria-label={t('notes')} className="field text-sm" placeholder={t('notesPlaceholder')} value={notes} onChange={(e) => setNotes(e.target.value)} />

        <button type="submit" disabled={!canSubmit || needsSdgRate} className="btn btn-primary w-full py-3 text-base">
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4 rtl:-scale-x-100" aria-hidden />}
          {confirmLabel}
        </button>
      </form>
    </section>
  );
}
