'use client';

import { AlertTriangle, Banknote, Landmark, Lock, Pencil, Plus, Wallet as WalletIcon } from 'lucide-react';
import { useApp } from './Providers';
import { formatMoney, fromAED, toAED } from '@/lib/currency';
import { freeBalance } from '@/lib/reserve';
import { px as ptx } from '@/lib/ptext';
import type { RateMap, Wallet } from '@/lib/types';

interface Props {
  wallets: Wallet[];
  rates: RateMap;
  reserved: Map<string, number>;
  onAdd: () => void;
  onEdit: (w: Wallet) => void;
}

function iconFor(name: string) {
  const n = name.toLowerCase();
  if (/(cash|كاش|نقد)/.test(n)) return Banknote;
  if (/(bank|بنك|nbd|adcb|fab|mashreq|مصرف)/.test(n)) return Landmark;
  return WalletIcon;
}

export function BalanceCards({ wallets, rates, reserved, onAdd, onEdit }: Props) {
  const { t, lang } = useApp();

  let totalAED = 0;
  let unconverted = false;
  for (const w of wallets) {
    const v = toAED(w.balance, w.currency, rates);
    if (v === null) unconverted = true;
    else totalAED += v;
  }
  const totalSDG = fromAED(totalAED, 'SDG', rates);
  const totalUSD = fromAED(totalAED, 'USD', rates);

  return (
    <section aria-labelledby="balances-title" className="w-full min-w-0 max-w-full space-y-3 overflow-hidden">
      {/* Total */}
      <div className="card relative w-full max-w-full overflow-hidden">
        <div className="pointer-events-none absolute -top-16 size-48 rounded-full bg-brand-500/10 blur-2xl ltr:-right-10 rtl:-left-10" />
        <p id="balances-title" className="text-sm font-semibold text-muted dark:text-night-muted">{t('totalBalance')}</p>
        <p className="num mt-1 flex w-full max-w-full flex-wrap items-baseline gap-x-2 break-all font-mono text-2xl font-semibold tracking-tight min-[400px]:text-3xl sm:text-4xl">
          {formatMoney(totalAED, 'AED', lang)}
          {unconverted && <span className="text-base text-gold"> *</span>}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted dark:text-night-muted">
          {totalSDG !== null && <span className="num font-mono">≈ {formatMoney(totalSDG, 'SDG', lang, 0)}</span>}
          {totalUSD !== null && <span className="num font-mono">≈ {formatMoney(totalUSD, 'USD', lang)}</span>}
        </div>
      </div>

      {/* Wallets: horizontal scroll on phones, grid on desktop */}
      <div className="flex w-full max-w-full snap-x gap-3 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible lg:grid-cols-3">
        {wallets.map((w) => {
          const Icon = iconFor(w.name);
          const low = w.min_balance_threshold > 0 && w.balance < w.min_balance_threshold;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onEdit(w)}
              className={`card group w-44 shrink-0 snap-start text-start transition hover:border-brand-500/50 sm:w-auto ${
                low ? 'border-rose-300 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40' : ''
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className={`inline-flex size-9 items-center justify-center rounded-xl ${low ? 'bg-rose-100 text-rose-600 dark:bg-rose-900/50 dark:text-rose-300' : 'bg-brand-50 text-brand-700 dark:bg-brand-900/50 dark:text-brand-400'}`}>
                  <Icon className="size-4" aria-hidden />
                </span>
                <Pencil className="size-3.5 opacity-0 transition group-hover:opacity-50" aria-hidden />
              </div>
              <p className="truncate text-sm font-semibold">{w.name}</p>
              <p className={`num mt-0.5 font-mono text-lg font-semibold ${low ? 'text-rose-600 dark:text-rose-300' : ''}`}>
                {formatMoney(w.balance, w.currency, lang)}
              </p>
              {(reserved.get(w.id) ?? 0) > 0 && (
                <div className="num mt-1.5 space-y-0.5 border-t border-line pt-1.5 text-[11px] dark:border-night-line">
                  <p className="flex items-center justify-between gap-1 text-muted dark:text-night-muted">
                    <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />{ptx(lang, 'reservedLabel')}</span>
                    <span className="font-mono" dir="ltr">− {formatMoney(reserved.get(w.id) ?? 0, w.currency, lang)}</span>
                  </p>
                  <p className="flex items-center justify-between gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                    <span>{ptx(lang, 'freeLabel')}</span>
                    <span className="font-mono" dir="ltr">{formatMoney(freeBalance(w, reserved), w.currency, lang)}</span>
                  </p>
                </div>
              )}
              {low && (
                <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-300">
                  <AlertTriangle className="size-3" aria-hidden /> {t('belowMin')}
                </p>
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onAdd}
          className="flex w-44 shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-line p-4 text-sm font-semibold text-muted transition hover:border-brand-500 hover:text-brand-600 sm:w-auto dark:border-night-line dark:text-night-muted"
        >
          <Plus className="size-5" aria-hidden />
          {t('addWallet')}
        </button>
      </div>

      {wallets.length === 0 && <p className="text-sm text-muted dark:text-night-muted">{t('noWallets')}</p>}
    </section>
  );
}
