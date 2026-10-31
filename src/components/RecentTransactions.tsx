'use client';

import { ArrowDownLeft, ArrowUpRight, Send } from 'lucide-react';
import { useApp } from './Providers';
import { APP_TZ } from '@/lib/time';
import { formatMoney } from '@/lib/currency';
import { dictionaries, type DictKey } from '@/lib/i18n';
import type { Txn, Wallet } from '@/lib/types';

export function RecentTransactions({ txns, wallets, limit }: { txns: Txn[]; wallets: Wallet[]; limit: number }) {
  const { t, lang } = useApp();
  const byId = new Map(wallets.map((w) => [w.id, w]));
  const loc = lang === 'ar' ? 'ar-AE-u-nu-latn' : 'en-AE';
  const fmt = new Intl.DateTimeFormat(loc, { timeZone: APP_TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  function categoryLabel(c: string | null) {
    if (!c) return '—';
    const key = `cat_${c}` as DictKey;
    return key in dictionaries.ar ? t(key) : c;
  }

  const rows = txns.slice(0, limit);

  return (
    <section className="card" aria-labelledby="recent-title">
      <h2 id="recent-title" className="mb-2 text-base font-bold">{t('recentTxns')}</h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted dark:text-night-muted">{t('noTxns')}</p>
      ) : (
        <ul className="divide-y divide-line dark:divide-night-line">
          {rows.map((x) => {
            const wallet = byId.get(x.wallet_id);
            const income = x.type === 'INCOME';
            const Icon = income ? ArrowDownLeft : x.type === 'TRANSFER' ? Send : ArrowUpRight;
            return (
              <li key={x.id} className="flex items-center gap-3 py-2.5">
                <span
                  className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${
                    income ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'
                  }`}
                >
                  <Icon className="size-4 rtl:-scale-x-100" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{x.notes?.trim() || categoryLabel(x.category)}</p>
                  <p className="truncate text-xs text-muted dark:text-night-muted">
                    {categoryLabel(x.category)} · {wallet?.name ?? '—'} · <span className="num">{fmt.format(new Date(x.date))}</span>
                  </p>
                </div>
                <span className={`num shrink-0 font-mono text-sm font-semibold ${income ? 'text-brand-700 dark:text-brand-400' : ''}`}>
                  {income ? '+' : '−'}
                  {formatMoney(x.amount, wallet?.currency ?? 'AED', lang)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
