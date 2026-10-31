'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Loader2, Lock, Plus, RefreshCw, Search, Send } from 'lucide-react';
import { useApp } from '@/components/Providers';
import { useData } from '@/lib/data';
import { FinanceNav } from '@/components/FinanceNav';
import { TransactionForm } from '@/components/TransactionForm';
import { supabase } from '@/lib/supabase';
import { formatMoney } from '@/lib/currency';
import { dictionaries, type DictKey } from '@/lib/i18n';
import { APP_TZ, intlLocale, startOfMonthDubai } from '@/lib/time';
import type { Txn, TxnType } from '@/lib/types';

const COLS =
  'id,wallet_id,to_wallet_id,to_amount,type,category,amount,original_amount,original_currency,exchange_rate_used,notes,date,debt_payment_id';
const PAGE = 50;

type TypeFilter = 'ALL' | TxnType;
type MonthFilter = 'ALL' | 'THIS' | 'LAST';

function normalize(rows: unknown[] | null): Txn[] {
  return ((rows ?? []) as Txn[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
    to_amount: r.to_amount == null ? null : Number(r.to_amount),
    original_amount: r.original_amount == null ? null : Number(r.original_amount),
    exchange_rate_used: r.exchange_rate_used == null ? null : Number(r.exchange_rate_used),
  }));
}

export default function TransactionsPage() {
  const { t, lang } = useApp();
  const data = useData();
  const [type, setType] = useState<TypeFilter>('ALL');
  const [walletId, setWalletId] = useState('');
  const [month, setMonth] = useState<MonthFilter>('THIS');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [rows, setRows] = useState<Txn[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Txn | null | undefined>(undefined); // undefined=closed, null=create
  const seq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  const build = useCallback(
    (from: number, withCount: boolean) => {
      let q = supabase()
        .from('transactions')
        .select(COLS, withCount ? { count: 'exact' } : undefined)
        .order('date', { ascending: false })
        .order('id', { ascending: false })
        .range(from, from + PAGE - 1);
      if (type !== 'ALL') q = q.eq('type', type);
      if (walletId) q = q.or(`wallet_id.eq.${walletId},to_wallet_id.eq.${walletId}`);
      if (month !== 'ALL') {
        const start = startOfMonthDubai(new Date(), month === 'THIS' ? 0 : -1);
        const end = startOfMonthDubai(new Date(), month === 'THIS' ? 1 : 0);
        q = q.gte('date', start.toISOString()).lt('date', end.toISOString());
      }
      if (debounced) q = q.ilike('notes', `%${debounced.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      return q;
    },
    [type, walletId, month, debounced],
  );

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    setError(null);
    const { data: d, error: e, count } = await build(0, true);
    if (my !== seq.current) return; // a newer filter change superseded this request
    if (e) setError(e.message);
    else {
      setRows(normalize(d));
      setTotal(count);
    }
    setLoading(false);
  }, [build]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    const my = seq.current;
    setMore(true);
    const { data: d, error: e } = await build(rows.length, false);
    setMore(false);
    if (my !== seq.current) return;
    if (e) return setError(e.message);
    const next = normalize(d);
    setRows((prev) => {
      const seen = new Set(prev.map((r) => r.id)); // new rows may have shifted the offset: never show one twice
      return [...prev, ...next.filter((r) => !seen.has(r.id))];
    });
  }

  const byId = useMemo(() => new Map(data.allWallets.map((w) => [w.id, w])), [data.allWallets]);
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(intlLocale(lang), { timeZone: APP_TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    [lang],
  );
  const catLabel = (c: string | null) => {
    if (!c) return '—';
    const key = `cat_${c}` as DictKey;
    return key in dictionaries.ar ? t(key) : c;
  };

  async function afterSave() {
    await Promise.all([data.refreshMoney(), load()]);
  }

  const TYPES: { v: TypeFilter; label: string }[] = [
    { v: 'ALL', label: t('filterAll') },
    { v: 'INCOME', label: t('typeIncome') },
    { v: 'EXPENSE', label: t('typeExpense') },
    { v: 'TRANSFER', label: t('typeTransfer') },
  ];

  return (
    <>
      <FinanceNav />

      <section className="card" aria-labelledby="txn-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="txn-title" className="text-base font-bold">{t('txnsTitle')}</h2>
          <button type="button" className="btn btn-primary" onClick={() => setSheet(null)} disabled={data.wallets.length === 0}>
            <Plus className="size-4" aria-hidden /> {t('addTxn')}
          </button>
        </div>

        <div className="mb-3 space-y-2">
          <div className="segmented" role="group" aria-label={t('filterType')}>
            {TYPES.map((x) => (
              <button key={x.v} type="button" aria-pressed={type === x.v} onClick={() => setType(x.v)}>{x.label}</button>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <select aria-label={t('filterWallet')} className="field" value={walletId} onChange={(e) => setWalletId(e.target.value)}>
              <option value="">{t('allWallets')}</option>
              {data.allWallets.map((w) => <option key={w.id} value={w.id}>{w.name} · {w.currency}</option>)}
            </select>
            <select aria-label={t('filterMonth')} className="field" value={month} onChange={(e) => setMonth(e.target.value as MonthFilter)}>
              <option value="THIS">{t('thisMonthOpt')}</option>
              <option value="LAST">{t('lastMonthOpt')}</option>
              <option value="ALL">{t('allMonths')}</option>
            </select>
            <label className="relative block">
              <span className="sr-only">{t('filterSearch')}</span>
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <input className="field ps-9" placeholder={t('filterSearch')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </label>
          </div>
        </div>

        {error ? (
          <div className="py-6 text-center">
            <p className="mb-3 text-sm text-rose-600">{t('error')}: {error}</p>
            <button type="button" className="btn btn-primary" onClick={load}><RefreshCw className="size-4" aria-hidden /> {t('retry')}</button>
          </div>
        ) : loading && rows.length === 0 ? (
          <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-brand-600" aria-label={t('loading')} /></div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted dark:text-night-muted">{t('noMatch')}</p>
        ) : (
          <>
            <ul className={`divide-y divide-line dark:divide-night-line ${loading ? 'opacity-60' : ''}`}>
              {rows.map((x) => {
                const w = byId.get(x.wallet_id);
                const to = x.to_wallet_id ? byId.get(x.to_wallet_id) : undefined;
                const income = x.type === 'INCOME';
                const internal = x.type === 'TRANSFER' && !!x.to_wallet_id;
                const locked = !!x.debt_payment_id;
                const Icon = income ? ArrowDownLeft : internal ? ArrowLeftRight : x.type === 'TRANSFER' ? Send : ArrowUpRight;
                const walletLine = internal ? `${w?.name ?? '—'} → ${to?.name ?? '—'}` : w?.name ?? '—';
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      onClick={() => setSheet(x)}
                      className="flex w-full items-center gap-3 rounded-xl py-3 text-start transition hover:bg-paper/60 dark:hover:bg-night/60"
                    >
                      <span className={`inline-flex size-9 shrink-0 items-center justify-center rounded-xl ${income ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-400' : internal ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300' : 'bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300'}`}>
                        <Icon className="size-4 rtl:-scale-x-100" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 truncate text-sm font-semibold">
                          {x.notes?.trim() || catLabel(x.category)}
                          {locked && <Lock className="size-3 shrink-0 text-muted" aria-label={t('editLocked')} />}
                        </span>
                        <span className="block truncate text-xs text-muted dark:text-night-muted">
                          {catLabel(x.category)} · {walletLine} · <span className="num">{fmt.format(new Date(x.date))}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-end">
                        <span className={`num block font-mono text-sm font-semibold ${income ? 'text-brand-700 dark:text-brand-400' : ''}`} dir="ltr">
                          {income ? '+' : internal ? '' : '−'}{formatMoney(x.amount, w?.currency ?? 'AED', lang)}
                        </span>
                        {internal && x.to_amount != null && to && to.currency !== w?.currency && (
                          <span className="num block font-mono text-xs text-muted dark:text-night-muted" dir="ltr">→ {formatMoney(x.to_amount, to.currency, lang)}</span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-3 flex flex-col items-center gap-2">
              {total != null && (
                <p className="text-xs text-muted dark:text-night-muted">
                  {t('showing')} <span className="num">{rows.length}</span> / <span className="num">{total}</span>
                </p>
              )}
              {total != null && rows.length < total && (
                <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={more}>
                  {more && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('loadMore')}
                </button>
              )}
            </div>
          </>
        )}
      </section>

      {sheet !== undefined && (
        <TransactionForm txn={sheet} wallets={data.allWallets} rates={data.rates} onClose={() => setSheet(undefined)} onSaved={afterSave} />
      )}
    </>
  );
}
