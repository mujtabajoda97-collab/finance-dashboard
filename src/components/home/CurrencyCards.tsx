'use client';

import Link from 'next/link';
import { AlertTriangle, ChevronLeft, Lock } from 'lucide-react';
import { useApp } from '../Providers';
import { formatMoney } from '@/lib/currency';
import { totalsByCurrency } from '@/lib/reserve';
import { px as tx, type AnyKey } from '@/lib/ptext';
import type { Currency, Wallet } from '@/lib/types';

const TONES: Record<Currency, string> = {
  AED: 'from-amber-500/25 to-amber-900/10 border-amber-400/50',
  SDG: 'from-emerald-500/25 to-emerald-900/10 border-emerald-400/40',
  USD: 'from-sky-500/20 to-sky-900/10 border-sky-400/30',
};

/** Home page: one summary card per currency (all wallets of that currency added together). */
export function CurrencyCards({ wallets, reserved }: { wallets: Wallet[]; reserved: Map<string, number> }) {
  const { lang } = useApp();
  const T = (k: AnyKey) => tx(lang, k);
  const totals = totalsByCurrency(wallets, reserved);

  return (
    <section aria-label={T('byCurrency')} className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-bold">{T('byCurrency')}</h2>
        <Link href="/finance/" className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-700 dark:text-brand-400">
          {T('walletDetails')} <ChevronLeft className="size-3.5 rtl:rotate-0 ltr:rotate-180" aria-hidden />
        </Link>
      </div>

      {totals.length === 0 ? (
        <Link href="/finance/" className="card block py-6 text-center text-sm text-muted dark:text-night-muted">{T('noWalletsHome')}</Link>
      ) : (
        <div className={`grid gap-3 ${totals.length === 1 ? 'grid-cols-1' : 'grid-cols-2'} ${totals.length >= 3 ? 'lg:grid-cols-3' : ''}`}>
          {totals.map((c) => (
            <Link
              key={c.currency}
              href="/finance/"
              className={`min-w-0 rounded-2xl border bg-gradient-to-br p-3 transition active:scale-[0.98] ${TONES[c.currency]}`}
            >
              <p className="text-xs font-semibold opacity-80">
                {c.currency} · {c.wallets} {T('walletsCount')}
              </p>
              <p className="num mt-1 break-all font-mono text-lg font-bold leading-tight sm:text-xl" dir="ltr">
                {formatMoney(c.total, c.currency, lang)}
              </p>
              {c.reserved > 0 && (
                <div className="mt-2 space-y-0.5 border-t border-black/10 pt-1.5 text-[11px] dark:border-white/10">
                  <p className="num flex items-center justify-between gap-1 opacity-80">
                    <span className="inline-flex items-center gap-1"><Lock className="size-3" aria-hidden />{T('reservedLabel')}</span>
                    <span className="font-mono" dir="ltr">{formatMoney(c.reserved, c.currency, lang, 0)}</span>
                  </p>
                  <p className="num flex items-center justify-between gap-1 font-semibold">
                    <span>{T('freeLabel')}</span>
                    <span className="font-mono" dir="ltr">{formatMoney(c.free, c.currency, lang, 0)}</span>
                  </p>
                </div>
              )}
              {c.low > 0 && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                  <AlertTriangle className="size-3" aria-hidden /> {c.low} {T('lowWallets')}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
