-- Behaviour tests for 0001 + 0003. Run ONLY against a throwaway local Postgres
-- (needs the auth stub: auth.users, auth.uid(), roles anon/authenticated/service_role).
-- Never run against the real project. Stops at the first failing assertion.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function t_ok(c boolean, m text) returns void language plpgsql as $$
begin
  if c is distinct from true then raise exception 'FAIL: %', m; end if;
  raise notice 'PASS: %', m;
end $$;
create or replace function t_err(q text, m text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then raise notice 'PASS: % [%]', m, sqlerrm; return; end;
  raise exception 'FAIL (expected an error): %', m;
end $$;
create or replace function t_err_like(q text, pat text, m text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like pat then raise notice 'PASS: % [%]', m, sqlerrm; return; end if;
    raise exception 'FAIL: % — wrong error: %', m, sqlerrm;
  end;
  raise exception 'FAIL (expected an error): %', m;
end $$;
create or replace function bal(n text) returns numeric language sql stable as
$$ select balance from public.wallets where name = n $$;
create or replace function as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', u::text, false);
end $$;

insert into auth.users(id,email) values
 ('aaaaaaaa-0000-0000-0000-000000000001','a@test'),
 ('bbbbbbbb-0000-0000-0000-000000000002','b@test');

set role authenticated;
select as_user('aaaaaaaa-0000-0000-0000-000000000001');

-- ---------- wallets ----------
insert into wallets(name,currency,opening_balance) values
 ('W1','AED',1000),('W2','AED',0),('W3','SDG',0),('W4','USD',0),('WARCH','AED',0);
update wallets set is_archived = true where name='WARCH';
select t_ok(bal('W1')=1000 and bal('W2')=0, 'opening balance sets balance');
select t_err($$update wallets set balance=999999 where name='W1'$$, 'dummy') where false;
update wallets set balance=999999 where name='W1';
select t_ok(bal('W1')=1000, 'client cannot set balance by hand');

-- ---------- income / expense ----------
insert into transactions(wallet_id,type,category,amount)
  select id,'INCOME','SALARY',500 from wallets where name='W1';
select t_ok(bal('W1')=1500, 'income adds');
insert into transactions(wallet_id,type,category,amount)
  select id,'EXPENSE','FOOD',100 from wallets where name='W1';
select t_ok(bal('W1')=1400, 'expense subtracts');

-- edit amount
update transactions set amount=250 where category='FOOD';
select t_ok(bal('W1')=1250, 'editing expense 100->250 recalculates');
-- edit type EXPENSE -> INCOME
update transactions set type='INCOME' where category='FOOD';
select t_ok(bal('W1')=1750, 'editing type expense->income recalculates');
update transactions set type='EXPENSE', amount=100 where category='FOOD';
select t_ok(bal('W1')=1400, 'edit back');
-- move to another wallet
update transactions set wallet_id=(select id from wallets where name='W2') where category='FOOD';
select t_ok(bal('W1')=1500 and bal('W2')=-100, 'moving expense to other wallet moves the effect');
delete from transactions where category='FOOD';
select t_ok(bal('W1')=1500 and bal('W2')=0, 'deleting expense restores balance');

-- ---------- idempotency ----------
insert into transactions(wallet_id,type,category,amount,client_request_id)
  select id,'EXPENSE','TAXI',50,'11111111-1111-1111-1111-111111111111' from wallets where name='W1';
select t_ok(bal('W1')=1450, 'request #1 applied');
select t_err($$insert into transactions(wallet_id,type,category,amount,client_request_id)
  select id,'EXPENSE','TAXI',50,'11111111-1111-1111-1111-111111111111' from wallets where name='W1'$$,
  'duplicate client_request_id rejected');
select t_ok(bal('W1')=1450, 'duplicate did not change balance');

-- ---------- transfers ----------
-- same currency
insert into transactions(wallet_id,to_wallet_id,type,amount)
  select a.id,b.id,'TRANSFER',200 from wallets a, wallets b where a.name='W1' and b.name='W2';
select t_ok(bal('W1')=1250 and bal('W2')=200, 'same-currency transfer debits and credits');
select t_ok(bal('W1')+bal('W2')=1450, 'transfer conserves total');
-- cross currency requires to_amount
select t_err($$insert into transactions(wallet_id,to_wallet_id,type,amount)
  select a.id,b.id,'TRANSFER',100 from wallets a, wallets b where a.name='W1' and b.name='W3'$$,
  'cross-currency transfer without to_amount rejected');
select t_ok(bal('W1')=1250 and bal('W3')=0, 'rejected transfer left both sides untouched');
insert into transactions(wallet_id,to_wallet_id,type,amount,to_amount,original_amount,original_currency,exchange_rate_used)
  select a.id,b.id,'TRANSFER',100,6000,6000,'SDG',60 from wallets a, wallets b where a.name='W1' and b.name='W3';
select t_ok(bal('W1')=1150 and bal('W3')=6000, 'cross-currency transfer uses to_amount');
select t_err($$insert into transactions(wallet_id,to_wallet_id,type,amount,to_amount)
  select a.id,b.id,'TRANSFER',100,90 from wallets a, wallets b where a.name='W1' and b.name='W2'$$,
  'to_amount != amount in same currency rejected');
select t_err($$insert into transactions(wallet_id,to_wallet_id,type,amount)
  select a.id,b.id,'TRANSFER',10 from wallets a, wallets b where a.name='W1' and b.name='WARCH'$$,
  'transfer to archived wallet rejected');
select t_err_like($$insert into transactions(wallet_id,to_wallet_id,type,amount)
  select id,id,'TRANSFER',10 from wallets where name='W1'$$, '%to itself%', 'transfer to the same wallet rejected (validate trigger)');
select t_err_like($$insert into transactions(wallet_id,to_wallet_id,type,amount,to_amount)
  select id,id,'TRANSFER',10,10 from wallets where name='W1'$$, '%to itself%', 'same-wallet transfer with to_amount rejected');
select t_err_like($$insert into transactions(wallet_id,to_wallet_id,type,amount)
  select a.id,b.id,'EXPENSE',10 from wallets a,wallets b where a.name='W1' and b.name='W2'$$, '%only to wallet-to-wallet%', 'to_wallet_id on a non-transfer rejected');
select t_err_like($$update transactions set to_wallet_id=wallet_id where type='TRANSFER' and to_wallet_id is not null$$, '%to itself%', 'editing a transfer into a self-transfer rejected') where exists (select 1 from transactions where type='TRANSFER' and to_wallet_id is not null);
select t_ok(bal('W1')=1150 and bal('W2')=200, 'rejected self-transfers left balances untouched');
select t_err($$insert into transactions(wallet_id,type,amount,to_amount)
  select id,'EXPENSE',10,10 from wallets where name='W1'$$, 'to_amount on non-transfer rejected');
-- edit transfer
update transactions set amount=300 where type='TRANSFER' and to_amount is null;
select t_ok(bal('W1')=1050 and bal('W2')=300, 'editing transfer amount rebalances both wallets');
select t_ok(bal('W1')+bal('W2')+bal('W3')/60=1350+100, 'cross-wallet totals still consistent');
update transactions set to_wallet_id=(select id from wallets where name='W2') where false;
-- delete transfers
delete from transactions where type='TRANSFER';
select t_ok(bal('W1')=1450 and bal('W2')=0 and bal('W3')=0, 'deleting transfers restores both sides');

-- ---------- debts ----------
insert into debts(person_name,type,currency,total_amount)
  values ('Ali','PAYABLE','AED',1000);
select t_ok((select status from debts where person_name='Ali')='OPEN', 'new debt OPEN');
insert into debt_payments(debt_id,wallet_id,amount,client_request_id)
  select d.id,w.id,300,'22222222-2222-2222-2222-222222222222' from debts d, wallets w where d.person_name='Ali' and w.name='W1';
select t_ok(bal('W1')=1150, 'partial payment debits wallet');
select t_ok((select paid_amount from debts where person_name='Ali')=300
        and (select status from debts where person_name='Ali')='PARTIAL', 'debt PARTIAL, paid 300');
select t_ok((select count(*) from transactions where category='DEBT')=1
        and (select type from transactions where category='DEBT')='EXPENSE', 'payment posted as DEBT/EXPENSE transaction');
select t_err($$insert into debt_payments(debt_id,wallet_id,amount,client_request_id)
  select d.id,w.id,300,'22222222-2222-2222-2222-222222222222' from debts d, wallets w where d.person_name='Ali' and w.name='W1'$$,
  'duplicate payment request rejected');
select t_ok(bal('W1')=1150 and (select paid_amount from debts where person_name='Ali')=300, 'duplicate left no trace');
select t_err($$insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,800 from debts d, wallets w where d.person_name='Ali' and w.name='W1'$$, 'over-payment rejected');
select t_ok(bal('W1')=1150, 'over-payment did not touch the wallet');
insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,700 from debts d, wallets w where d.person_name='Ali' and w.name='W1';
select t_ok((select status from debts where person_name='Ali')='PAID' and bal('W1')=450, 'final payment -> PAID');
select t_err($$insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,1 from debts d, wallets w where d.person_name='Ali' and w.name='W1'$$, 'payment on PAID debt rejected');
-- client cannot hand-edit progress
select t_err_like($$update debts set paid_amount=0 where person_name='Ali'$$, '%maintained automatically%', 'authenticated cannot set paid_amount');
select t_err_like($$update debts set status='OPEN' where person_name='Ali'$$, '%maintained automatically%', 'authenticated cannot set status');
select t_err_like($$update debts set paid_amount=1, status='OPEN' where person_name='Ali'$$, '%maintained automatically%', 'authenticated cannot set both');
update debts set paid_amount=paid_amount, status=status, notes='whole-row update with unchanged progress is fine' where person_name='Ali';
select t_ok((select paid_amount from debts where person_name='Ali')=1000
        and (select status from debts where person_name='Ali')='PAID', 'progress intact; whole-row update with unchanged values allowed');
update debts set total_amount=1500 where person_name='Ali';
select t_ok((select status from debts where person_name='Ali')='PARTIAL', 'raising total reopens debt as PARTIAL');
select t_err($$update debts set total_amount=900 where person_name='Ali'$$, 'total below paid rejected');
select t_err($$update debts set currency='USD' where person_name='Ali'$$, 'currency frozen after payments');
-- debt payment rows cannot be edited; delete restores
select t_err($$update debt_payments set amount=1$$, 'payments immutable');
delete from debt_payments where amount=300;
select t_ok(bal('W1')=750 and (select paid_amount from debts where person_name='Ali')=700, 'deleting a payment restores wallet and recalculates debt');
delete from debt_payments;
select t_ok(bal('W1')=1450 and (select status from debts where person_name='Ali')='OPEN', 'all payments removed -> OPEN, wallet restored');

-- repayments are not income/expense in the month totals (category DEBT, filtered by the app)
insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,100 from debts d, wallets w where d.person_name='Ali' and w.name='W1';
select t_ok((select count(*) from transactions where debt_payment_id is not null and category='DEBT')=1, 'repayment tagged DEBT');
select t_err($$delete from transactions where category='DEBT'$$, 'dummy') where false;
delete from transactions where category='DEBT';  -- policy: client may not touch debt rows
select t_ok((select count(*) from transactions where category='DEBT')=1, 'client cannot delete a debt-payment transaction directly');
update transactions set amount=1 where category='DEBT';
select t_ok((select amount from transactions where category='DEBT')=100, 'client cannot edit a debt-payment transaction directly');
delete from debt_payments;

-- receivable in another currency
insert into debts(person_name,type,currency,total_amount) values ('Omar','RECEIVABLE','USD',100);
select t_err($$insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,40 from debts d, wallets w where d.person_name='Omar' and w.name='W1'$$,
  'cross-currency payment needs wallet_amount');
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,40,146.8 from debts d, wallets w where d.person_name='Omar' and w.name='W1';
select t_ok(bal('W1')=1596.8, 'USD receivable received into AED wallet credits the AED amount');
select t_ok((select paid_amount from debts where person_name='Omar')=40
        and (select status from debts where person_name='Omar')='PARTIAL', 'debt progress tracked in debt currency');
select t_ok((select type from transactions where category='DEBT')='INCOME', 'receivable payment is INCOME-direction but DEBT-tagged');
delete from debt_payments;
select t_ok(bal('W1')=1450, 'reverted');

-- ---------- wallet currency lock ----------
select t_err($$update wallets set currency='USD' where name='W1'$$, 'currency change blocked when wallet has history');
update wallets set currency='USD' where name='W4';
select t_ok((select currency from wallets where name='W4')='USD'::currency_code, 'empty wallet can still change currency');
insert into wallets(name,currency) values ('Empty','AED');
update wallets set currency='SDG' where name='Empty';
select t_ok((select currency from wallets where name='Empty')='SDG'::currency_code, 'fresh wallet currency editable');

-- ---------- budgets ----------
insert into budgets(category,limit_aed) values ('FOOD',500),(null,3000);
select t_err($$insert into budgets(category,limit_aed) values ('FOOD',1)$$, 'one budget per category');
select t_err($$insert into budgets(category,limit_aed) values (null,1)$$, 'one overall budget');
select t_err($$insert into budgets(category,limit_aed) values ('X',0)$$, 'limit must be positive');
insert into budgets(category,limit_aed) values ('*',10);
select t_ok((select count(*) from budgets where category='*')=1 and (select count(*) from budgets where category is null)=1, 'a category literally named * coexists with the overall budget');
select t_err($$insert into budgets(category,limit_aed) values ('*',20)$$, 'duplicate * category still rejected');
select t_err($$insert into budgets(category,limit_aed) values ('   ',20)$$, 'blank category rejected');

-- ---------- month_summary ----------
insert into transactions(wallet_id,type,category,amount,date)
  select id,'EXPENSE','FOOD',40,'2026-10-05 10:00+04' from wallets where name='W1';
insert into transactions(wallet_id,type,category,amount,date)
  select id,'EXPENSE','FOOD',60,'2026-10-31 23:59+04' from wallets where name='W1';
insert into transactions(wallet_id,type,category,amount,date)
  select id,'EXPENSE','FOOD',999,'2026-11-01 00:00+04' from wallets where name='W1';
select t_ok((select total from month_summary('2026-10-01 00:00+04','2026-11-01 00:00+04') where category='FOOD' and txn_type='EXPENSE')=100
        and (select n from month_summary('2026-10-01 00:00+04','2026-11-01 00:00+04') where category='FOOD')=2,
        'month_summary respects Dubai month boundaries (end-exclusive)');

-- bulk: 12,000 rows, exact totals through the RPC
insert into transactions(wallet_id,type,category,amount,date)
  select (select id from wallets where name='W2'),'INCOME','BULK',1.25, '2026-09-15 12:00+04'::timestamptz + (g||' seconds')::interval
  from generate_series(1,12000) g;
select t_ok((select total from month_summary('2026-09-01 00:00+04','2026-10-01 00:00+04') where category='BULK')=15000.00
        and (select n from month_summary('2026-09-01 00:00+04','2026-10-01 00:00+04') where category='BULK')=12000,
        'month_summary exact for 12,000 rows (beyond any row cap)');
select t_ok(bal('W2')=15000, 'balance exact after 12,000 inserts');
delete from transactions where category='BULK';
select t_ok(bal('W2')=0, 'balance exact after deleting them');

-- ---------- reconciliation ----------
select t_ok((select count(*) from wallet_reconciliation where drift<>0)=0, 'wallet_reconciliation: zero drift for all wallets');
select t_err($$select recompute_wallet_balances()$$, 'repair function not callable by clients');

-- ---------- isolation ----------
select as_user('bbbbbbbb-0000-0000-0000-000000000002');
select t_ok((select count(*) from wallets)=0 and (select count(*) from transactions)=0
        and (select count(*) from debts)=0 and (select count(*) from budgets)=0, 'user B sees none of user A data');
select t_ok((select count(*) from month_summary('2020-01-01','2030-01-01'))=0, 'month_summary isolated by RLS');
insert into wallets(name,currency) values ('BW','AED');
select t_err($$insert into transactions(wallet_id,to_wallet_id,type,amount)
  select b.id,(select id from wallets where name='BW'),'TRANSFER',5 from wallets b limit 0$$, 'dummy') where false;
reset role;
select as_user('bbbbbbbb-0000-0000-0000-000000000002');
set role authenticated;
-- B tries to touch A's wallet id
do $$ declare aw uuid; begin
  reset role; select id into aw from wallets where name='W1'; set role authenticated;
  begin
    insert into transactions(wallet_id,type,amount) values (aw,'EXPENSE',5);
    raise exception 'FAIL: B posted into A wallet';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: B cannot post into A wallet [%]', sqlerrm;
  end;
  begin
    insert into transactions(wallet_id,to_wallet_id,type,amount)
      values ((select id from wallets where name='BW'),aw,'TRANSFER',5);
    raise exception 'FAIL: B transferred into A wallet';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: B cannot transfer into A wallet [%]', sqlerrm;
  end;
end $$;

-- ---------- reconciliation covers every txn_type (as the owner, no RLS) ----------
reset role;
select t_ok((select string_agg(enumlabel::text, ',' order by enumlabel) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='txn_type')='EXPENSE,INCOME,TRANSFER',
  'txn_type has exactly EXPENSE, INCOME, TRANSFER');
select as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
insert into wallets(name,currency,opening_balance) values ('R1','AED',1000),('R2','AED',0),('R3','SDG',0);
-- one of each kind, all through the normal write path
insert into transactions(wallet_id,type,category,amount) select id,'INCOME','SALARY',500 from wallets where name='R1';
insert into transactions(wallet_id,type,category,amount) select id,'EXPENSE','FOOD',120 from wallets where name='R1';
insert into transactions(wallet_id,to_wallet_id,type,category,amount) select a.id,b.id,'TRANSFER','INTERNAL_TRANSFER',200 from wallets a,wallets b where a.name='R1' and b.name='R2';
insert into transactions(wallet_id,to_wallet_id,type,category,amount,to_amount) select a.id,b.id,'TRANSFER','INTERNAL_TRANSFER',100,16000 from wallets a,wallets b where a.name='R1' and b.name='R3';
insert into transactions(wallet_id,type,category,amount) select id,'TRANSFER','SUDAN_TRANSFER',50 from wallets where name='R1';
insert into debts(person_name,type,total_amount) values ('RP','PAYABLE',300),('RR','RECEIVABLE',300);
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,100 from debts d,wallets w where d.person_name='RP' and w.name='R1';
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,40  from debts d,wallets w where d.person_name='RR' and w.name='R1';
-- hand-computed: R1 = 1000 +500 -120 -200 -100 -50 -100(payable repaid) +40(receivable collected) = 970
select t_ok(bal('R1')=970 and bal('R2')=200 and bal('R3')=16000, 'balances follow the hand-computed model');
select t_ok((select expected_balance from wallet_reconciliation where name='R1')=970
        and (select expected_balance from wallet_reconciliation where name='R2')=200
        and (select expected_balance from wallet_reconciliation where name='R3')=16000, 'wallet_reconciliation expected_balance = hand-computed for income/expense/internal/cross/Sudan/debt');
select t_ok((select count(*) from wallet_reconciliation where drift<>0)=0, 'zero drift with every transaction kind present');
-- the app's month rules on the same data: DEBT excluded, internal transfers skipped, Sudan separate
select t_ok((select sum(total) from month_summary('2000-01-01','2100-01-01') where category='DEBT' and txn_type='EXPENSE')=100
        and (select sum(total) from month_summary('2000-01-01','2100-01-01') where category='DEBT' and txn_type='INCOME')=40,
        'debt repayments are returned under category DEBT so the app can exclude them');
select t_ok((select sum(total) from month_summary('2000-01-01','2100-01-01') where category='SUDAN_TRANSFER')=50, 'Sudan transfers bucketed separately');

-- delete / edit keep reconciliation at zero
update transactions set amount=300 where category='INTERNAL_TRANSFER' and to_amount is null and notes is null;
delete from transactions where category='SUDAN_TRANSFER';
select t_ok((select count(*) from wallet_reconciliation where drift<>0)=0, 'zero drift after editing a transfer and deleting a Sudan transfer');
delete from debt_payments where debt_id=(select id from debts where person_name='RP');
select t_ok((select count(*) from wallet_reconciliation where drift<>0)=0, 'zero drift after deleting a debt payment');
select t_ok(bal('R1')=1000+500-120-300-100+40, 'R1 balance after edits');

-- ---------- repair tool: clients cannot, service_role can ----------
select t_err_like($$select recompute_wallet_balances()$$, '%permission denied%', 'authenticated cannot run the repair function');
reset role;
update wallets set balance = balance + 77 where name='R1';                 -- simulate drift
select as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
select t_ok((select drift from wallet_reconciliation where name='R1')=77, 'reconciliation detects drift');
reset role;
set role service_role;
select t_ok(recompute_wallet_balances()=1, 'service_role repair fixed exactly one wallet');
select t_ok((select count(*) from wallet_reconciliation where drift<>0)=0, 'zero drift after repair');
reset role;

-- ---------- SECURITY DEFINER hardening ----------
-- every SECURITY DEFINER function in public must pin search_path with pg_temp last
select t_ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
              and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=public, pg_temp'))=0,
  'all SECURITY DEFINER functions in public use search_path=public, pg_temp');
-- exploit attempt: a TEMP table named like a real one must not hijack the definer triggers
select as_user('aaaaaaaa-0000-0000-0000-000000000001');
set role authenticated;
create temp table wallets (like public.wallets including all);
insert into pg_temp.wallets select * from public.wallets;               -- a fake copy the attacker controls
insert into transactions(wallet_id,type,category,amount) select id,'EXPENSE','HACK',10 from public.wallets where name='R2';
select t_ok((select balance from public.wallets where name='R2')=290, 'temp-table shadowing did not stop the real wallet from being debited');
drop table pg_temp.wallets;
reset role;

-- ---------- privilege audit (Supabase default ACLs grant EXECUTE on new functions to API roles) ----------
select t_ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prosecdef
              and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')))=0,
  'no SECURITY DEFINER function is executable by anon / authenticated');
select t_ok((select count(*) from pg_proc p where p.pronamespace='public'::regnamespace and p.prorettype='trigger'::regtype and not p.prosecdef
              and has_function_privilege('authenticated', p.oid, 'execute'))>=0, 'info: invoker-only trigger functions may keep default EXECUTE (cannot be called outside a trigger)');
select t_ok(not has_function_privilege('anon', 'public.month_summary(timestamptz,timestamptz)', 'execute')
        and has_function_privilege('authenticated', 'public.month_summary(timestamptz,timestamptz)', 'execute'), 'month_summary: authenticated yes, anon no');
\echo ALL TESTS PASSED
