'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { reservedByWallet } from './reserve';
import type { AlertLog, Debt, FundReservation, Profile, Project, ProjectCashflow, RatePoint } from './types';

/** Debts, alert log, profile and 7-day rate history. Each part fails on its own without breaking the app. */
export function useExtraData(enabled: boolean) {
  const [debts, setDebts] = useState<Debt[]>([]);
  const [alerts, setAlerts] = useState<AlertLog[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [rateHistory, setRateHistory] = useState<RatePoint[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cashflows, setCashflows] = useState<ProjectCashflow[]>([]);
  /** false when the projects tables do not exist yet (SQL 0005 not applied). */
  const [projectsReady, setProjectsReady] = useState(true);
  /** true once SQL 0007 (target_date, paid_amount, project_receive) is applied. */
  const [projectsV2, setProjectsV2] = useState(false);
  const [reservations, setReservations] = useState<FundReservation[]>([]);
  /** true once SQL 0008 (fund_reservations, debt_pay, project_spend) is applied. */
  const [reservationsReady, setReservationsReady] = useState(false);
  const reserved = useMemo(() => reservedByWallet(reservations), [reservations]);
  const [extraError, setExtraError] = useState<string | null>(null);

  const loadDebts = useCallback(async () => {
    const base = 'id,person_name,type,currency,total_amount,paid_amount,due_date,status,notes,created_at';
    const q = (cols: string) =>
      supabase().from('debts').select(cols)
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(500);
    // Columns missing until SQL 0005 / 0009 are applied: fall back step by step.
    let res = await q(`${base},remind_before_minutes,alarm_enabled`);
    if (res.error) res = await q(`${base},remind_before_minutes`);
    if (res.error) res = await q(base);
    if (res.error) throw res.error;
    const rows = (res.data ?? []) as unknown as Record<string, unknown>[];
    setDebts(
      rows.map((d) => ({ ...d, total_amount: Number(d.total_amount), paid_amount: Number(d.paid_amount) })) as unknown as Debt[],
    );
  }, []);

  const loadProjects = useCallback(async () => {
    const pBase = 'id,name,budget,currency,allocated_amount,notes,is_archived,created_at';
    const cBase = 'id,project_id,direction,title,amount,currency,due_date,is_done,debt_id';
    const run = (v2: boolean, alarm = false) =>
      Promise.all([
        supabase().from('projects').select(v2 ? `${pBase},target_date` : pBase)
          .eq('is_archived', false).order('created_at', { ascending: false }).limit(200),
        supabase().from('project_cashflows').select(v2 ? `${cBase},paid_amount${alarm ? ',alarm_enabled' : ''}` : cBase)
          .order('due_date', { ascending: true, nullsFirst: false }).limit(2000),
      ]);
    let v2 = true;
    let [p, c] = await run(true, true);
    // New columns missing until SQL 0009 / 0007 are applied: fall back step by step.
    if (p.error || c.error) [p, c] = await run(true);
    if (p.error || c.error) {
      v2 = false;
      [p, c] = await run(false);
    }
    if (p.error || c.error) {
      setProjectsReady(false);
      setProjects([]);
      setCashflows([]);
      return; // fail-soft: the rest of the app keeps working
    }
    setProjectsReady(true);
    setProjectsV2(v2);
    const pr = (p.data ?? []) as unknown as Record<string, unknown>[];
    const cr = (c.data ?? []) as unknown as Record<string, unknown>[];
    setProjects(pr.map((r) => ({ ...r, budget: Number(r.budget), allocated_amount: Number(r.allocated_amount) })) as unknown as Project[]);
    setCashflows(cr.map((r) => ({ ...r, amount: Number(r.amount), ...(v2 ? { paid_amount: Number(r.paid_amount ?? 0) } : {}) })) as unknown as ProjectCashflow[]);
  }, []);

  const loadReservations = useCallback(async () => {
    const { data, error } = await supabase()
      .from('fund_reservations')
      .select('id,project_id,wallet_id,amount,project_amount,created_at')
      .limit(2000);
    if (error) { // table missing until SQL 0008 is applied: fail-soft
      setReservationsReady(false);
      setReservations([]);
      return;
    }
    setReservationsReady(true);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    setReservations(rows.map((r) => ({ ...r, amount: Number(r.amount), project_amount: Number(r.project_amount) })) as unknown as FundReservation[]);
  }, []);

  const loadAlerts = useCallback(async () => {
    const { data, error } = await supabase()
      .from('alert_logs')
      .select('id,alert_type,message,created_at')
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw error;
    setAlerts((data ?? []) as AlertLog[]);
  }, []);

  const loadProfile = useCallback(async () => {
    const q = (cols: string) => supabase().from('profiles').select(cols).maybeSingle();
    let res = await q('display_name,telegram_chat_id,whatsapp_phone,green_api_id_instance,green_api_token_instance');
    // New columns missing until SQL 0006 is applied: fall back to the basic ones.
    if (res.error) res = await q('display_name,telegram_chat_id,whatsapp_phone');
    if (res.error) throw res.error;
    setProfile((res.data ?? null) as unknown as Profile | null);
  }, []);

  const loadRateHistory = useCallback(async () => {
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data, error } = await supabase()
      .from('exchange_rate_history')
      .select('rate,recorded_at')
      .eq('base_currency', 'AED')
      .eq('target_currency', 'SDG')
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true })
      .limit(500);
    if (error) throw error;
    setRateHistory((data ?? []).map((r) => ({ rate: Number(r.rate), recorded_at: r.recorded_at })));
  }, []);

  const loadExtra = useCallback(async () => {
    const results = await Promise.allSettled([loadDebts(), loadAlerts(), loadProfile(), loadRateHistory(), loadProjects(), loadReservations()]);
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    setExtraError(failed ? String(failed.reason?.message ?? failed.reason) : null);
  }, [loadDebts, loadAlerts, loadProfile, loadRateHistory, loadProjects, loadReservations]);

  useEffect(() => {
    if (enabled) loadExtra();
  }, [enabled, loadExtra]);

  return { debts, alerts, profile, rateHistory, projects, cashflows, projectsReady, projectsV2, loadProjects, reservations, reservationsReady, reserved, loadReservations, extraError, loadDebts, loadAlerts, loadProfile, loadRateHistory, loadExtra };
}
