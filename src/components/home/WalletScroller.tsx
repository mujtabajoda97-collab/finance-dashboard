'use client';

import { Plus } from 'lucide-react';
import { useApp } from '../Providers';
import { formatMoney } from '@/lib/currency';
import { isLowWallet } from '@/lib/derived';
import { tx } from '@/lib/text';
import type { Wallet } from '@/lib/types';

const TONES = [
  'from-amber-500/25 to-amber-900/10 border-amber-400/50',
  'from-emerald-500/25 to-emerald-900/10 border-emerald-400/40',
  'from-teal-500/20 to-teal-900/10 border-teal-400/30',
  'from-sky-500/20 to-sky-900/10 border-sky-400/30',
];

/** Horizontally scrolling wallet cards with a minimum-balance warning bar. */
export function WalletScroller({ wallets, onAdd, onEdit }: { wallets: Wallet[]; onAdd: () => void; onEdit: (w: Wallet) => void }) {
  const { lang } = useApp();
  const T = (k: Parameters<typeof tx>[1]) => tx(lang, k);
  return (
    <section aria-label={T('walletsAccounts')}>
      <h2 className="mb-2 text-base font-bold">{T('walletsAccounts')}</h2>
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 [scrollbar-width:none]">
        {wallets.map((w, i) => {
          const low = isLowWallet(w);
          const pct = w.min_balance_threshold > 0 ? Math.max(4, Math.min(100, (w.balance / (w.min_balance_threshold * 3)) * 100)) : 0;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => onEdit(w)}
              className={`min-w-[10.5rem] shrink-0 snap-start rounded-2xl border bg-gradient-to-br p-3 text-start transition active:scale-[0.98] ${low ? 'from-rose-500/25 to-rose-900/10 border-rose-400/50' : TONES[i % TONES.length]}`}
            >
              <p className="truncate text-xs font-semibold opacity-80">{w.name} · {w.currency}</p>
              <p className="num mt-1 font-mono text-lg font-bold">{formatMoney(w.balance, w.currency, lang)}</p>
              {w.min_balance_threshold > 0 && (
                <>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/25">
                    <div className={`h-full rounded-full ${low ? 'bg-rose-400' : 'bg-amber-300'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className={`num mt-1 text-[11px] ${low ? 'font-semibold text-rose-700 dark:text-rose-300' : 'opacity-70'}`}>
                    {low ? `${T('belowMin')}: ` : `${T('minLabel')}: `}{formatMoney(w.min_balance_threshold, w.currency, lang, 0)}
                  </p>
                </>
              )}
            </button>
          );
        })}
        <button type="button" onClick={onAdd} className="flex min-w-[6rem] shrink-0 snap-start items-center justify-center rounded-2xl border border-dashed border-line text-muted dark:border-night-line dark:text-night-muted" aria-label="+">
          <Plus className="size-6" aria-hidden />
        </button>
      </div>
    </section>
  );
}
