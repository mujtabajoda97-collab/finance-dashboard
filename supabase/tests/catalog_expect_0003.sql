-- Post-0003 catalog expectations. READ-ONLY: runs on a throwaway sim DB, the local CLI stack, or (if ever
-- approved) a Branch. Needs no privileges beyond catalog reads. Fails with a precise message on any deviation.
-- (1) all EIGHT functions defined by 0003, with security mode, pinned search_path and who may EXECUTE them;
-- (2) the other objects 0003 adds; (3) nothing else was added to public.
\set ON_ERROR_STOP on
set client_min_messages = notice;
do $$
declare
  r record; fx record; n int := 0; v text;
  expected_cfg constant text := 'search_path=public, pg_temp';
begin
  -- (1) the 8 functions: name | args | security definer? | authenticated may execute? | service_role may execute? (null = don't care)
  for r in
    select * from (values
      ('transaction_validate',        '',                                   true,  false, null::boolean),
      ('debt_payment_before_insert',  '',                                   true,  false, null),
      ('debt_payment_after_insert',   '',                                   true,  false, null),
      ('debt_before_update',          '',                                   false, false, null),
      ('wallet_currency_lock',        '',                                   false, false, null),
      ('month_summary',              'p_from timestamp with time zone, p_to timestamp with time zone', false, true,  true),
      ('wallet_expected_balance',    'p_wallet uuid',                       false, true,  true),
      ('recompute_wallet_balances',  'p_user uuid DEFAULT NULL::uuid',      false, false, true)
    ) as x(fname, args, secdef, auth_x, svc_x)
  loop
    begin
      select p2.oid, p2.prosecdef, p2.proconfig, pg_get_function_arguments(p2.oid) as fa into fx
        from pg_proc p2 where p2.pronamespace = 'public'::regnamespace and p2.proname = r.fname;
      if fx.oid is null then raise exception 'MISSING function %', r.fname; end if;
      if fx.fa is distinct from r.args then raise exception '% has arguments (%), expected (%)', r.fname, fx.fa, r.args; end if;
      if fx.prosecdef is distinct from r.secdef then raise exception '% prosecdef=% expected %', r.fname, fx.prosecdef, r.secdef; end if;
      if coalesce(fx.proconfig, '{}') is distinct from array[expected_cfg] then raise exception '% proconfig=% expected {%}', r.fname, fx.proconfig, expected_cfg; end if;
      if has_function_privilege('anon', fx.oid, 'EXECUTE') then raise exception '% is executable by anon', r.fname; end if;
      if has_function_privilege('authenticated', fx.oid, 'EXECUTE') is distinct from r.auth_x then raise exception '% authenticated EXECUTE expected %', r.fname, r.auth_x; end if;
      if r.svc_x is not null and has_function_privilege('service_role', fx.oid, 'EXECUTE') is distinct from r.svc_x then raise exception '% service_role EXECUTE expected %', r.fname, r.svc_x; end if;
      n := n + 1;
      raise notice 'PASS: function % (%)', r.fname, case when r.secdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end;
    end;
  end loop;
  if n <> 8 then raise exception 'expected 8 functions, verified %', n; end if;

  -- 10 pre-existing definer functions only had their search_path re-pinned
  select string_agg(p.proname, ',') into v from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef and coalesce(p.proconfig,'{}') is distinct from array[expected_cfg];
  if v is not null then raise exception 'SECURITY DEFINER functions without pinned search_path: %', v; end if;
  raise notice 'PASS: every SECURITY DEFINER function in public pins search_path = public, pg_temp';

  -- (2) other objects
  if (select count(*) from information_schema.columns where table_schema='public' and
        (table_name, column_name) in (('transactions','client_request_id'),('debt_payments','client_request_id'),
                                      ('debt_payments','wallet_amount'),('debt_payments','exchange_rate_used'))) <> 4
    then raise exception 'the 4 new columns are not all present'; end if;
  if (select count(*) from pg_indexes where schemaname='public' and indexname in
        ('transactions_client_req_uniq','debt_payments_client_req_uniq','budgets_user_category_uniq','budgets_user_overall_uniq')) <> 4
    then raise exception 'the 4 new indexes are not all present'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in
        ('trg_transaction_validate','trg_debt_payment_before_insert','trg_debt_before_update','trg_wallet_currency_lock','trg_budget_touch')) <> 5
    then raise exception 'the 5 new triggers are not all present'; end if;
  if not exists (select 1 from pg_class where relnamespace='public'::regnamespace and relname='budgets' and relrowsecurity)
    then raise exception 'budgets missing or RLS off'; end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='budgets' and policyname='own rows' and roles = '{authenticated}')
    then raise exception 'budgets policy missing'; end if;
  if not exists (select 1 from pg_class where relnamespace='public'::regnamespace and relname='wallet_reconciliation' and relkind='v' and reloptions @> array['security_invoker=true'])
    then raise exception 'wallet_reconciliation view missing or not security_invoker'; end if;
  if has_table_privilege('anon','public.budgets','SELECT') or has_table_privilege('anon','public.wallet_reconciliation','SELECT')
    then raise exception 'anon can read budgets / wallet_reconciliation'; end if;
  raise notice 'PASS: 4 columns, 4 indexes, 5 triggers, budgets (RLS + policy), wallet_reconciliation (security_invoker, no anon)';

  -- (3) nothing unexpected added: every non-extension function in public is either one of the 15 from 0001,
  --     one of the 7 new ones, or a known test helper (t_ok, ... only exist in throwaway DBs)
  select string_agg(p.proname, ', ' order by p.proname) into v from pg_proc p
   where p.pronamespace='public'::regnamespace
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and p.proname not in (
       'apply_transaction','debt_payment_after_insert','debt_payment_after_remove','debt_recalc','exchange_rate_log','forbid_update',
       'generate_due_alerts','generate_overdue_digest','handle_new_user','task_before_update','task_spawn_next','touch_updated_at',
       'transaction_balance_sync','wallet_low_balance_alert','wallet_opening_balance',
       'transaction_validate','debt_payment_before_insert','debt_before_update','wallet_currency_lock','month_summary',
       'wallet_expected_balance','recompute_wallet_balances',
       't_ok','t_err','t_err_like','bal','as_user','dpaid','dstat');
  if v is not null then raise exception 'unexpected functions in public: %', v; end if;
  raise notice 'PASS: no unexpected functions in public (15 from 0001 + 7 new; debt_payment_after_insert is replaced, not added)';
end $$;
\echo ALL CATALOG EXPECTATIONS PASSED
