-- Run as the PostgREST login role ("authenticator") against the sim DB AFTER 0003_behavior.sql.
-- Every block = one API request: BEGIN; SET LOCAL ROLE <jwt role>; claims as JSON; ...; COMMIT.
\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
\pset format unaligned
\pset tuples_only on
\echo '--- anon: no table access, no RPC'
begin; set local role anon; select set_config('request.jwt.claims','{"role":"anon"}',true);
select count(*) from wallets;
select * from month_summary('2000-01-01','2100-01-01');
select recompute_wallet_balances();
rollback;
\echo '--- authenticated (user A)'
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
select 'wallets visible: '||count(*) from wallets;
select 'month_summary rows: '||count(*) from month_summary('2000-01-01','2100-01-01');
\echo '  -> direct UPDATE of paid_amount (must fail):'
update debts set paid_amount = 5 where person_name='Ali';
\echo '  -> direct UPDATE of status (must fail):'
update debts set status = 'PAID' where person_name='Ali';
\echo '  -> RPC debt_recalc / apply_transaction / recompute / triggers (must be denied):'
select debt_recalc((select id from debts limit 1));
select recompute_wallet_balances();
select transaction_validate();
rollback;
\echo '--- authenticated pays an installment: debt_recalc must update paid_amount/status through the trigger path'
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}',true);
insert into debts(person_name,type,currency,total_amount) values ('ReqStyle','PAYABLE','AED',500);
insert into debt_payments(debt_id,wallet_id,amount,client_request_id) select d.id,w.id,200,gen_random_uuid() from debts d, wallets w where d.person_name='ReqStyle' and w.name='W1';
select 'after 200/500: '||paid_amount||' '||status from debts where person_name='ReqStyle';
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,300 from debts d, wallets w where d.person_name='ReqStyle' and w.name='W1';
select 'after 500/500: '||paid_amount||' '||status from debts where person_name='ReqStyle';
rollback;
\echo '--- user B cannot see user A rows'
begin; set local role authenticated; select set_config('request.jwt.claims','{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}',true);
select 'B sees wallets/txns/debts/budgets: '||(select count(*) from wallets)||'/'||(select count(*) from transactions)||'/'||(select count(*) from debts)||'/'||(select count(*) from budgets);
select 'B reconciliation rows: '||count(*) from wallet_reconciliation;
rollback;
\echo '--- service_role'
begin; set local role service_role;
select 'service_role reconciliation rows (all users): '||count(*) from wallet_reconciliation;
select 'service_role drift rows: '||count(*) from wallet_reconciliation where drift<>0;
select 'repaired: '||recompute_wallet_balances();
rollback;
\echo '--- can API roles create TEMP tables here (precondition for the shadowing attack)?'
select 'authenticated TEMP privilege: '||has_database_privilege('authenticated', current_database(), 'TEMP');
