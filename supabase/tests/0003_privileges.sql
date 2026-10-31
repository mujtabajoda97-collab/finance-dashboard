-- Privilege checks in the Supabase-like sim (throwaway DB). Run after 0001 + 0003.
\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', m; end if; raise notice 'PASS: %', m; end $$;
create or replace function t_err_like(q text, pat text, m text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like pat then raise notice 'PASS: % [%]', m, sqlerrm; return; end if;
    raise exception 'FAIL: % - wrong error: %', m, sqlerrm; end;
  raise exception 'FAIL (expected an error): %', m; end $$;

select t_ok(not has_schema_privilege('anon','public','CREATE') and not has_schema_privilege('authenticated','public','CREATE')
        and not has_schema_privilege('authenticator','public','CREATE') and not has_schema_privilege('service_role','public','CREATE'),
        'no API role has CREATE on schema public');
set role anon;
select t_err_like($$create table public.hack(x int)$$, '%permission denied for schema public%', 'anon cannot create tables in public');
select t_err_like($$create function public.hack() returns int language sql as 'select 1'$$, '%permission denied for schema public%', 'anon cannot create functions in public');
reset role; set role authenticated;
select t_err_like($$create table public.hack(x int)$$, '%permission denied for schema public%', 'authenticated cannot create tables in public');
select t_err_like($$create or replace function public.month_summary(timestamptz,timestamptz) returns int language sql as 'select 1'$$, '%permission denied for schema public%', 'authenticated cannot replace functions in public');
select t_err_like($$create view public.hack as select 1$$, '%permission denied for schema public%', 'authenticated cannot create views in public');
-- temp objects ARE allowed (Supabase grants TEMP on the database); that is why search_path ends in pg_temp
create temp table wallets(id uuid);
select t_ok(true, 'authenticated can still create TEMP tables (accepted; neutralised by search_path = public, pg_temp)');
drop table pg_temp.wallets;
select t_err_like($$truncate public.budgets$$, '%permission denied%', 'authenticated cannot TRUNCATE budgets');
reset role; set role anon;
select t_err_like($$select * from public.budgets$$, '%permission denied%', 'anon has no access to budgets at all');
select t_err_like($$insert into public.budgets(category,limit_aed) values ('x',1)$$, '%permission denied%', 'anon cannot insert budgets');
select t_err_like($$select * from public.wallet_reconciliation$$, '%permission denied%', 'anon cannot read wallet_reconciliation');
reset role;
select t_ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
              and (has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE')))=0,
        'no SECURITY DEFINER function is executable by anon/authenticated');
select t_ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
              and not coalesce(p.proconfig,'{}') @> array['search_path=public, pg_temp'])=0,
        'every SECURITY DEFINER function pins search_path = public, pg_temp');
select t_ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('month_summary','wallet_expected_balance')
              and has_function_privilege('anon',p.oid,'EXECUTE'))=0, 'anon cannot run month_summary / wallet_expected_balance');
\echo ALL PRIVILEGE TESTS PASSED
