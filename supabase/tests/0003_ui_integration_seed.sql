-- Seeds a known October-2026 dataset through the normal write path (as an authenticated user) in the
-- THROWAWAY sim DB, then prints {wallets, txns, buckets} as one JSON document for tests/ui_integration.test.ts.
\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set client_min_messages = warning;
reset role;
delete from auth.users where id='cccccccc-0000-0000-0000-000000000003';
insert into auth.users(id,email) values ('cccccccc-0000-0000-0000-000000000003','ui@test');
set role authenticated;
select set_config('request.jwt.claim.sub','cccccccc-0000-0000-0000-000000000003',false) \gset
\o /dev/null
insert into wallets(name,currency,opening_balance) values ('UA','AED',10000),('UA2','AED',0),('US','SDG',100000),('UU','USD',0);
-- ordinary income / expense (Dubai dates, inside October)
insert into transactions(wallet_id,type,category,amount,date) select id,'INCOME','SALARY',5000,'2026-10-03 09:00+04' from wallets where name='UA';
insert into transactions(wallet_id,type,category,amount,date) select id,'EXPENSE','FOOD',300,'2026-10-05 13:00+04' from wallets where name='UA';
insert into transactions(wallet_id,type,category,amount,date) select id,'EXPENSE','TRANSPORT',1600,'2026-10-06 08:00+04' from wallets where name='US';
-- internal transfers: same currency, and cross-currency AED -> USD
insert into transactions(wallet_id,to_wallet_id,type,category,amount,date) select a.id,b.id,'TRANSFER','INTERNAL_TRANSFER',200,'2026-10-07 10:00+04' from wallets a,wallets b where a.name='UA' and b.name='UA2';
insert into transactions(wallet_id,to_wallet_id,type,category,amount,to_amount,date) select a.id,b.id,'TRANSFER','INTERNAL_TRANSFER',367.25,100,'2026-10-08 10:00+04' from wallets a,wallets b where a.name='UA' and b.name='UU';
-- Sudan transfer: debit only, no destination wallet
insert into transactions(wallet_id,type,category,amount,date) select id,'TRANSFER','SUDAN_TRANSFER',800,'2026-10-09 10:00+04' from wallets where name='UA';
-- debts: payable 1000 AED (pay 400), receivable 500 AED (collect 200), USD payable 100 (pay 50 USD from the AED wallet = 183.63 AED)
insert into debts(person_name,type,total_amount,currency) values ('P1','PAYABLE',1000,'AED'),('R1','RECEIVABLE',500,'AED'),('P2','PAYABLE',100,'USD');
insert into debt_payments(debt_id,wallet_id,amount,payment_date) select d.id,w.id,400,'2026-10-10 10:00+04' from debts d,wallets w where d.person_name='P1' and w.name='UA';
insert into debt_payments(debt_id,wallet_id,amount,payment_date) select d.id,w.id,200,'2026-10-11 10:00+04' from debts d,wallets w where d.person_name='R1' and w.name='UA';
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount,payment_date) select d.id,w.id,50,183.63,'2026-10-12 10:00+04' from debts d,wallets w where d.person_name='P2' and w.name='UA';
-- outside the month (Dubai boundaries): last minute of September, first minute of November
insert into transactions(wallet_id,type,category,amount,date) select id,'INCOME','SALARY',777,'2026-09-30 23:59+04' from wallets where name='UA';
insert into transactions(wallet_id,type,category,amount,date) select id,'EXPENSE','FOOD',999,'2026-11-01 00:00+04' from wallets where name='UA';
\o
select json_build_object(
  'wallets', (select json_agg(w) from (select id,name,currency,balance from wallets order by name) w),
  'txns',    (select json_agg(t) from (select id,wallet_id,to_wallet_id,type,category,amount,date from transactions
                where date >= '2026-10-01 00:00+04' and date < '2026-11-01 00:00+04' order by date) t),
  'buckets', (select json_agg(b) from month_summary('2026-10-01 00:00+04','2026-11-01 00:00+04') b),
  'drift',   (select count(*) from wallet_reconciliation where drift<>0)
);
