'use client';

import { ArrowDownLeft, ArrowUpRight, Scale } from 'lucide-react';
import { useApp } from './Providers';
import { formatMoney } from '@/lib/currency';
import { APP_TZ, intlLocale } from '@/lib/time';
import { monthSummary } from '@/lib/stats';
import type { RateMap, Txn, Wallet } from '@/lib/types';

export function MonthSummary({ txns, wallets, rates, truncated = false }: { txns: Txn[]; wallets: Wallet[]; rates: RateMap; truncated?: boolean }) {
  const { t, lang } = useApp();
  const s = monthSummary(txns, wallets, rates);
  const monthName = new Intl.DateTimeFormat(intlLocale(lang), { month: 'long', year: 'numeric', timeZone: APP_TZ }).format(new Date());

  return (
    <section className="card" aria-labelledby="month-title">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 id="month-title" className="text-base font-bold">{t('thisMonth')}</h2>
        <span className="text-xs text-muted dark:text-night-muted">{monthName}</span>
      </div>

      {s.count === 0 ? (
        <p className="py-4 text-center text-sm text-muted dark:text-night-muted">{t('noMonthTxns')}</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Stat icon={ArrowDownLeft} label={t('incomeLabel')} value={formatMoney(s.income, 'AED', lang, 0)} tone="good" />
            <Stat icon={ArrowUpRight} label={t('expensesLabel')} value={formatMoney(s.expenses, 'AED', lang, 0)} tone="bad" />
            <Stat icon={Scale} label={t('netLabel')} value={formatMoney(s.net, 'AED', lang, 0)} tone={s.net < 0 ? 'bad' : 'neutral'} />
          </div>
          {s.sudan > 0 && (
            <p className="mt-3 text-sm text-muted dark:text-night-muted">
              {t('sentToSudan')}: <strong className="num font-mono text-ink dark:text-paper">{formatMoney(s.sudan, 'AED', lang, 0)}</strong>
            </p>
          )}
          <p className="mt-2 text-xs text-muted dark:text-night-muted">
            {t('monthNote')}
            {s.partial && <span className="text-gold"> *</span>}
            {truncated && <> {t('monthTruncated')}</>}
          </p>
        </>
      )}
    </section>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: typeof Scale; label: string; value: string; tone: 'good' | 'bad' | 'neutral' }) {
  const color =
    tone === 'good'
      ? 'text-brand-700 dark:text-brand-400'
      : tone === 'bad'
        ? 'text-rose-600 dark:text-rose-300'
        : 'text-ink dark:text-paper';
  return (
    <div className="min-w-0 rounded-2xl bg-paper p-3 dark:bg-night">
      <div className={`mb-1 flex items-center gap-1.5 text-xs font-semibold ${color}`}>
        <Icon className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate">{label}</span>
      </div>
      <p className={`num truncate font-mono text-sm font-semibold sm:text-base ${color}`}>{value}</p>
    </div>
  );
}
