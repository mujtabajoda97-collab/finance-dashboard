'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { toRateMap } from './currency';
import { fetchAllPages } from './paging';
import { startOfMonthDubai } from './time';
import type { ExchangeRate, Task, Txn, Wallet } from './types';

const TXN_COLS =
  'id,wallet_id,to_wallet_id,to_amount,type,category,amount,original_amount,original_currency,exchange_rate_used,notes,date,debt_payment_id';
// Only what the month summary needs (smaller payload than the full row).
const MONTH_COLS = 'id,wallet_id,type,category,amount,date';
// The API returns at most 1000 rows per request, so the month is read page by page.
export const PAGE_SIZE = 1000;
// Safety ceiling (10 pages). Beyond it the UI says the total is incomplete instead of guessing.
export const MONTH_TXN_CAP = 10_000;

function normalizeTxns(rows: unknown[] | null): Txn[] {
  return ((rows ?? []) as Txn[]).map((r) => ({
    ...r,
    amount: Number(r.amount),
    to_amount: r.to_amount == null ? null : Number(r.to_amount),
    original_amount: r.original_amount == null ? null : Number(r.original_amount),
    exchange_rate_used: r.exchange_rate_used == null ? null : Number(r.exchange_rate_used),
  }));
}

export function useDashboardData(enabled: boolean) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [allWallets, setAllWallets] = useState<Wallet[]>([]); // includes archived (names/balances for history)
  const [rateRows, setRateRows] = useState<ExchangeRate[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [monthTxns, setMonthTxns] = useState<Txn[]>([]);
  const [recentTxns, setRecentTxns] = useState<Txn[]>([]);
  const [monthTruncated, setMonthTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadWallets = useCallback(async () => {
    const { data, error } = await supabase().from('wallets').select('*').order('created_at');
    if (error) throw error;
    const rows: Wallet[] = (data ?? []).map((w) => ({
      ...w,
      balance: Number(w.balance),
      opening_balance: Number(w.opening_balance),
      min_balance_threshold: Number(w.min_balance_threshold),
    }));
    setAllWallets(rows);
    setWallets(rows.filter((w) => !w.is_archived));
  }, []);

  const loadRates = useCallback(async () => {
    const { data, error } = await supabase().from('exchange_rates').select('*');
    if (error) throw error;
    setRateRows((data ?? []).map((r) => ({ ...r, rate: Number(r.rate) })));
  }, []);

  // All open tasks (the UI filters: today / this week / overdue).
  const loadTasks = useCallback(async () => {
    const { data, error } = await supabase()
      .from('tasks')
      .select('*')
      .eq('is_completed', false)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(300);
    if (error) throw error;
    setTasks(data ?? []);
  }, []);

  // Every transaction of the current Dubai month (paged, so totals stay exact) + the 20 most recent.
  const loadTxns = useCallback(async () => {
    const sb = supabase();
    const from = startOfMonthDubai().toISOString();
    const to = startOfMonthDubai(new Date(), 1).toISOString();

    const fetchMonth = () =>
      fetchAllPages<unknown>(
        async (lo, hi) => {
          const { data, error } = await sb
            .from('transactions')
            .select(MONTH_COLS)
            .gte('date', from)
            .lt('date', to)
            .order('date', { ascending: false })
            .order('id', { ascending: false }) // stable order so pages never overlap
            .range(lo, hi);
          if (error) throw error;
          return data ?? [];
        },
        PAGE_SIZE,
        MONTH_TXN_CAP,
      );

    const [month, recent] = await Promise.all([
      fetchMonth(),
      sb.from('transactions').select(TXN_COLS).order('date', { ascending: false }).limit(20),
    ]);
    if (recent.error) throw recent.error;
    setMonthTxns(normalizeTxns(month.rows));
    setMonthTruncated(month.truncated);
    setRecentTxns(normalizeTxns(recent.data));
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadWallets(), loadRates(), loadTasks(), loadTxns()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [loadWallets, loadRates, loadTasks, loadTxns]);

  useEffect(() => {
    if (enabled) loadAll();
  }, [enabled, loadAll]);

  // Refresh when the installed app returns to the foreground.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => document.visibilityState === 'visible' && loadAll();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, loadAll]);

  // After any money movement: balances, rates and the transaction lists.
  const refreshMoney = useCallback(async () => {
    await Promise.all([loadWallets(), loadRates(), loadTxns()]);
  }, [loadWallets, loadRates, loadTxns]);

  const rates = useMemo(() => toRateMap(rateRows), [rateRows]);

  return {
    wallets, allWallets, rateRows, rates, tasks, monthTxns, monthTruncated, recentTxns, loading, error,
    loadAll, loadWallets, loadRates, loadTasks, loadTxns, refreshMoney, setTasks,
  };
}
