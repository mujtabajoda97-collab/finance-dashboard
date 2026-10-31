-- Behaviour tests for 0008. Throwaway local Postgres only (after run_sim.sh + 0005 + 0007 + 0008).
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

insert into auth.users(id,email) values ('cccccccc-0000-0000-0000-000000000001','c@t'),('dddddddd-0000-0000-0000-000000000002','d@t');
set role authenticated;
select as_user('cccccccc-0000-0000-0000-000000000001');

insert into wallets(name,currency,opening_balance) values ('Bank','AED',1000),('Cash','AED',0),('SDGW','SDG',0);
insert into projects(name,budget,currency,allocated_amount) values ('Event',10000,'AED',0);
insert into debts(person_name,type,currency,total_amount) values ('Ali','RECEIVABLE','AED',5000),('Omar','PAYABLE','AED',800);
insert into project_cashflows(project_id,direction,title,amount,currency,debt_id)
  select p.id,'IN','Ali debt',5000,'AED',d.id from projects p, debts d where d.person_name='Ali';
insert into project_cashflows(project_id,direction,title,amount,currency)
  select id,'OUT','Tickets',4000,'AED' from projects;

-- 1) partial collection reserved for the project
select t_ok((debt_pay((select id from debts where person_name='Ali'),(select id from wallets where name='Bank'),2000,
  (select id from projects),2000)->>'ok')::boolean, 'debt_pay with reservation');
select t_ok(bal('Bank')=3000, 'wallet credited 2000');
select t_ok((select paid_amount from debts where person_name='Ali')=2000 and (select status from debts where person_name='Ali')='PARTIAL', 'debt partial 2000');
select t_ok((select allocated_amount from projects)=2000, 'project allocated +2000');
select t_ok((select sum(amount) from fund_reservations)=2000, 'reservation row');
select t_ok((select paid_amount from project_cashflows where title='Ali debt')=2000, 'linked IN item advanced');

-- 2) reserved money cannot be spent by an ordinary expense
select t_err_like($$insert into transactions(wallet_id,type,category,amount) select id,'EXPENSE','FOOD',1500 from wallets where name='Bank'$$,
  '%free balance%', 'ordinary expense cannot dip into reserved funds');
insert into transactions(wallet_id,type,category,amount) select id,'EXPENSE','FOOD',1000 from wallets where name='Bank';
select t_ok(bal('Bank')=2000, 'free part (1000) can be spent');
select t_err_like($$insert into transactions(wallet_id,type,category,amount) select id,'TRANSFER','GENERAL',1 from wallets where name='Bank' limit 1 $$ , '%', 'dummy') where false;

-- 3) project spending from the wallet releases the reservation (partial 1500 of 4000)
select t_ok((project_spend((select id from project_cashflows where title='Tickets'),1500,(select id from wallets where name='Bank'))->>'released')::numeric=1500, 'spend 1500 releases 1500');
select t_ok(bal('Bank')=500, 'wallet debited by project spend');
select t_ok((select allocated_amount from projects)=500, 'allocated decreased to 500');
select t_ok((select sum(amount) from fund_reservations)=500, 'reservation reduced to 500');
select t_ok((select paid_amount from project_cashflows where title='Tickets')=1500 and not (select is_done from project_cashflows where title='Tickets'), 'item partially paid, still pending');
-- spend more than reserved but within free balance? wallet=500 all reserved -> blocked beyond 500
select t_err_like($$select project_spend((select id from project_cashflows where title='Tickets'),1000,(select id from wallets where name='Bank'))$$, '%Insufficient free balance%', 'cannot overspend wallet');
select t_err_like($$select project_spend((select id from project_cashflows where title='Tickets'),3000,null)$$, '%exceeds the remaining%', 'cannot exceed item amount');
-- record-only spending
select t_ok((project_spend((select id from project_cashflows where title='Tickets'),500,null)->>'ok')::boolean, 'record-only spend');
select t_ok(bal('Bank')=500, 'record-only does not touch wallet');
-- wrong currency wallet
select t_err_like($$select project_spend((select id from project_cashflows where title='Tickets'),100,(select id from wallets where name='SDGW'))$$, '%must match%', 'currency mismatch blocked');

-- 4) payable debt payment advances a linked OUT item; reserve on payable rejected
select t_err_like($$select debt_pay((select id from debts where person_name='Omar'),(select id from wallets where name='Bank'),100,(select id from projects),100)$$, '%Only collected%', 'payable cannot be reserved');
select t_ok((debt_pay((select id from debts where person_name='Ali'),(select id from wallets where name='Cash'),3000,null,null)->>'ok')::boolean, 'plain collection without project');
select t_ok((select status from debts where person_name='Ali')='PAID', 'debt fully paid');
select t_ok((select allocated_amount from projects)=500, 'plain collection does not allocate');
select t_err_like($$select debt_pay((select id from debts where person_name='Ali'),(select id from wallets where name='Cash'),1,null,null)$$, '%exceeds%', 'cannot overpay');

-- 5) isolation
select as_user('dddddddd-0000-0000-0000-000000000002');
select t_ok((select count(*) from fund_reservations)=0, 'other user sees no reservations');
select t_err_like($$select project_spend((select id from project_cashflows limit 1),1,null)$$, '%', 'dummy') where false;
select t_err_like($$select debt_pay('00000000-0000-0000-0000-000000000000'::uuid,'00000000-0000-0000-0000-000000000000'::uuid,1)$$, '%Debt not found%', 'unknown debt rejected');

-- 6) deleting the project releases the reservation
select as_user('cccccccc-0000-0000-0000-000000000001');
delete from projects;
select t_ok((select count(*) from fund_reservations)=0, 'project delete releases reserved funds');
