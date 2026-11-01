-- Behaviour tests for 0009. Throwaway local Postgres only (after run_sim.sh + 0005 + 0007 + 0008 + 0009).
\set ON_ERROR_STOP on
set client_min_messages = notice;
create or replace function t_ok(c boolean, m text) returns void language plpgsql as $$
begin if c is distinct from true then raise exception 'FAIL: %', m; end if; raise notice 'PASS: %', m; end $$;
create or replace function t_err_like(q text, pat text, m text) returns void language plpgsql as $$
begin
  begin execute q; exception when others then
    if sqlerrm like pat then raise notice 'PASS: % [%]', m, sqlerrm; return; end if;
    raise exception 'FAIL: % — wrong error: %', m, sqlerrm;
  end;
  raise exception 'FAIL (expected an error): %', m;
end $$;
create or replace function as_user(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u::text, false); end $$;
create or replace function bal(n text) returns numeric language sql stable as $$ select balance from public.wallets where name = n $$;

insert into auth.users(id,email) values ('eeeeeeee-0000-0000-0000-000000000001','e@t'),('ffffffff-0000-0000-0000-000000000002','f@t');
set role authenticated;
select as_user('eeeeeeee-0000-0000-0000-000000000001');

insert into wallets(name,currency,opening_balance) values ('Bank','AED',2000),('SDGW','SDG',0);
insert into debts(person_name,type,currency,total_amount) values ('Omar','PAYABLE','AED',1000),('Ali','RECEIVABLE','AED',1000);
insert into projects(name,budget,currency,allocated_amount) values ('Event',5000,'AED',0);

-- 1) borrowing more (PAYABLE): 1000 -> 1500, wallet receives 500
select t_ok((debt_increase((select id from debts where person_name='Omar'),(select id from wallets where name='Bank'),500,'extra loan')->>'ok')::boolean, 'increase payable');
select t_ok((select total_amount from debts where person_name='Omar')=1500, 'payable total 1500');
select t_ok(bal('Bank')=2500, 'wallet credited 500');
select t_ok((select count(*) from transactions where type='INCOME' and category='DEBT' and amount=500)=1, 'income txn category DEBT');
select t_ok((select count(*) from debt_events where kind='INCREASE' and total_before=1000 and total_after=1500)=1, 'history row');

-- 2) partial payment afterwards still works against the new total (status PARTIAL, remaining 1500-200)
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,200 from debts d, wallets w where d.person_name='Omar' and w.name='Bank';
select t_ok((select status from debts where person_name='Omar')='PARTIAL' and (select paid_amount from debts where person_name='Omar')=200, 'payment after increase');
select debt_increase((select id from debts where person_name='Omar'),(select id from wallets where name='Bank'),100);
select t_ok((select total_amount from debts where person_name='Omar')=1600 and (select status from debts where person_name='Omar')='PARTIAL', 'second increase keeps PARTIAL');

-- 3) lending more (RECEIVABLE): money leaves the wallet
select t_ok(bal('Bank')=2400, 'balance before lending');
select debt_increase((select id from debts where person_name='Ali'),(select id from wallets where name='Bank'),400);
select t_ok((select total_amount from debts where person_name='Ali')=1400 and bal('Bank')=2000, 'receivable +400, wallet -400');
select t_ok((select count(*) from transactions where type='EXPENSE' and category='DEBT' and amount=400)=1, 'expense txn category DEBT');

-- 4) guards
select t_err_like($$select debt_increase((select id from debts where person_name='Ali'),(select id from wallets where name='Bank'),0)$$, '%positive%', 'zero rejected');
select t_err_like($$select debt_increase((select id from debts where person_name='Ali'),(select id from wallets where name='SDGW'),10)$$, '%must match%', 'currency mismatch rejected');
select t_err_like($$select debt_increase((select id from debts where person_name='Ali'),(select id from wallets where name='Bank'),99999)$$, '%Insufficient%', 'cannot lend more than the free balance');
-- reserved money counts as not free
insert into fund_reservations(project_id,wallet_id,amount,project_amount) select p.id,w.id,1800,1800 from projects p, wallets w where w.name='Bank';
select t_err_like($$select debt_increase((select id from debts where person_name='Ali'),(select id from wallets where name='Bank'),300)$$, '%Insufficient%', 'reserved funds are not available for lending');
select t_ok((debt_increase((select id from debts where person_name='Omar'),(select id from wallets where name='Bank'),50)->>'ok')::boolean, 'borrowing is fine while funds are reserved');
-- settled debt
select as_user('eeeeeeee-0000-0000-0000-000000000001');
insert into debts(person_name,type,currency,total_amount) values ('Done','PAYABLE','AED',100);
insert into debt_payments(debt_id,wallet_id,amount) select d.id,w.id,100 from debts d, wallets w where d.person_name='Done' and w.name='Bank';
select t_err_like($$select debt_increase((select id from debts where person_name='Done'),(select id from wallets where name='Bank'),10)$$, '%already settled%', 'settled debt rejected');

-- 5) other user cannot touch it, direct client edits are still blocked
select as_user('ffffffff-0000-0000-0000-000000000002');
select t_err_like($$select debt_increase((select id from debts where person_name='Omar' limit 1),(select id from wallets limit 1),10)$$, '%not found%', 'other user: debt not found');
select t_ok((select count(*) from debt_events)=0, 'other user sees no history (RLS)');
select as_user('eeeeeeee-0000-0000-0000-000000000001');
select t_err_like($$insert into debt_events(debt_id,kind,amount,total_before,total_after) select id,'INCREASE',1,1,2 from debts limit 1$$, '%permission denied%', 'clients cannot write history directly');

-- 6) alarm flags
update tasks set alarm_enabled = false where false;
insert into tasks(title) values ('T1');
update tasks set alarm_enabled = true where title='T1';
select t_ok((select alarm_enabled from tasks where title='T1'), 'task alarm flag');
update debts set alarm_enabled = true where person_name='Omar';
select t_ok((select alarm_enabled from debts where person_name='Omar'), 'debt alarm flag');
select 'ALL 0009 TESTS DONE' as result;
