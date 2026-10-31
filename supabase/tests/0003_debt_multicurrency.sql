-- Multi-currency debt repayment scenarios (throwaway sim DB, after 0001 + 0003). Self-contained.
--   amount        = installment in the DEBT's currency   -> reduces debts.paid_amount
--   wallet_amount = what leaves/enters the WALLET (its currency) -> posted to the balance
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
create or replace function bal(n text) returns numeric language sql stable as $$ select balance from public.wallets where name = n $$;
create or replace function dpaid(n text) returns numeric language sql stable as $$ select paid_amount from public.debts where person_name = n $$;
create or replace function dstat(n text) returns text language sql stable as $$ select status::text from public.debts where person_name = n $$;

reset role;
delete from auth.users where id='dddddddd-0000-0000-0000-000000000004';
insert into auth.users(id,email) values ('dddddddd-0000-0000-0000-000000000004','mc@test');
set role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-0000-0000-0000-000000000004',false) \gset

insert into wallets(name,currency,opening_balance) values ('MA','AED',1000),('MS','SDG',200000);

-- ===== Scenario 1: debt in SDG (I owe 160,000 SDG), paid from an AED wallet =====
insert into debts(person_name,type,currency,total_amount) values ('D_SDG','PAYABLE','SDG',160000);
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,16000,100 from debts d,wallets w where d.person_name='D_SDG' and w.name='MA';
select t_ok(bal('MA')=900, 'S1: wallet (AED) is debited the AED amount only: 1000 -> 900');
select t_ok(dpaid('D_SDG')=16000 and dstat('D_SDG')='PARTIAL', 'S1: debt (SDG) is settled by the SDG amount: paid 16000, PARTIAL');
select t_ok((select amount from transactions where category='DEBT' order by created_at limit 1)=100
        and (select type::text from transactions where category='DEBT' order by created_at limit 1)='EXPENSE'
        and (select original_amount from transactions where category='DEBT' order by created_at limit 1)=16000
        and (select original_currency::text from transactions where category='DEBT' order by created_at limit 1)='SDG'
        and (select exchange_rate_used from transactions where category='DEBT' order by created_at limit 1)=0.006250,
        'S1: wallet transaction = EXPENSE 100 AED, original 16000 SDG, rate 0.00625');
select t_ok((select wallet_amount from debt_payments limit 1)=100 and (select exchange_rate_used from debt_payments limit 1)=0.006250, 'S1: payment row stores wallet_amount and rate');

-- second installment at a different rate (rate is per payment, rounded to 6 dp; the wallet amount stays exact)
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,32000,210 from debts d,wallets w where d.person_name='D_SDG' and w.name='MA';
select t_ok(bal('MA')=690 and dpaid('D_SDG')=48000, 'S1: 2nd installment 32000 SDG for 210 AED: wallet 690, paid 48000');
select t_ok((select exchange_rate_used from debt_payments order by created_at desc limit 1)=0.006563, 'S1: stored rate rounded to 6 dp (0.0065625 -> 0.006563)');
select t_ok((select amount from transactions where category='DEBT' order by created_at desc limit 1)=210, 'S1: but the wallet is debited the exact 210, not rate*amount');

-- over-payment is judged in the DEBT currency, whatever the wallet amount is
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,112000.01,1 from debts d,wallets w where d.person_name='D_SDG' and w.name='MA'$$,
  'Payment exceeds remaining amount%', 'S1: 112000.01 SDG exceeds the remaining 112000 SDG (even for 1 AED)');
select t_ok(bal('MA')=690 and dpaid('D_SDG')=48000, 'S1: rejected payment changed nothing');
-- pay exactly the remainder -> PAID
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,112000,600 from debts d,wallets w where d.person_name='D_SDG' and w.name='MA';
select t_ok(dpaid('D_SDG')=160000 and dstat('D_SDG')='PAID' and bal('MA')=90, 'S1: exact remainder -> PAID, wallet 90');
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,1,1 from debts d,wallets w where d.person_name='D_SDG' and w.name='MA'$$,
  'Payment exceeds remaining amount%', 'S1: nothing can be paid on a PAID debt');
-- deleting the last installment gives back the exact AED amount
delete from debt_payments where amount=112000;
select t_ok(bal('MA')=690 and dpaid('D_SDG')=48000 and dstat('D_SDG')='PARTIAL', 'S1: deleting an installment restores 600 AED and 112000 SDG remaining');

-- ===== Scenario 2: debt in AED (I owe 1,000 AED), paid from an SDG wallet =====
insert into debts(person_name,type,currency,total_amount) values ('D_AED','PAYABLE','AED',1000);
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,100,16000 from debts d,wallets w where d.person_name='D_AED' and w.name='MS';
select t_ok(bal('MS')=184000, 'S2: wallet (SDG) is debited the SDG amount only: 200000 -> 184000');
select t_ok(dpaid('D_AED')=100 and dstat('D_AED')='PARTIAL', 'S2: debt (AED) is settled by the AED amount: paid 100');
select t_ok((select amount from transactions where original_currency='AED' and category='DEBT')=16000
        and (select original_amount from transactions where original_currency='AED' and category='DEBT')=100
        and (select exchange_rate_used from transactions where original_currency='AED' and category='DEBT')=160.000000,
        'S2: wallet transaction = EXPENSE 16000 SDG, original 100 AED, rate 160');

-- receivable in AED collected into the SDG wallet
insert into debts(person_name,type,currency,total_amount) values ('R_AED','RECEIVABLE','AED',500);
insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,50,8100 from debts d,wallets w where d.person_name='R_AED' and w.name='MS';
select t_ok(bal('MS')=192100 and dpaid('R_AED')=50, 'S2: receivable 50 AED collected as 8100 SDG: wallet +8100, debt paid 50');
select t_ok((select type::text from transactions where original_currency='AED' and original_amount=50)='INCOME', 'S2: receivable payment credits the wallet (INCOME-direction, DEBT-tagged)');

-- ===== Guards =====
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,10 from debts d,wallets w where d.person_name='D_AED' and w.name='MS'$$,
  'wallet_amount (in SDG) is required%', 'G1: cross-currency payment without wallet_amount rejected (SDG wallet, AED debt)');
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,10 from debts d,wallets w where d.person_name='D_SDG' and w.name='MA'$$,
  'wallet_amount (in AED) is required%', 'G1b: cross-currency payment without wallet_amount rejected (AED wallet, SDG debt)');
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,10,0 from debts d,wallets w where d.person_name='D_AED' and w.name='MS'$$,
  '%debt_payments_wallet_amount_pos%', 'G2: wallet_amount = 0 rejected');
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,10,-5 from debts d,wallets w where d.person_name='D_AED' and w.name='MS'$$,
  '%debt_payments_wallet_amount_pos%', 'G2b: negative wallet_amount rejected');
insert into wallets(name,currency,opening_balance) values ('MA2','AED',50);
select t_err_like($$insert into debt_payments(debt_id,wallet_id,amount,wallet_amount)
  select d.id,w.id,10,11 from debts d,wallets w where d.person_name='D_AED' and w.name='MA2'$$,
  'wallet_amount must equal amount%', 'G3: same-currency payment cannot carry a different wallet_amount');
insert into debt_payments(debt_id,wallet_id,amount)
  select d.id,w.id,10 from debts d,wallets w where d.person_name='D_AED' and w.name='MA2';
select t_ok(bal('MA2')=40 and dpaid('D_AED')=110, 'G3b: same-currency payment: wallet_amount defaults to amount (50 -> 40), no rate stored');
select t_ok((select exchange_rate_used from debt_payments where wallet_id=(select id from wallets where name='MA2')) is null, 'G3c: no exchange rate stored for same-currency payment');

-- ===== Totals =====
select t_ok(bal('MA')=690 and bal('MS')=192100 and bal('MA2')=40, 'T1: final balances: MA 690, MS 192100, MA2 40');
select t_ok((select count(*) from wallet_reconciliation where drift<>0)=0, 'T2: zero reconciliation drift after every multi-currency scenario');
select t_ok((select total from month_summary('2000-01-01','2100-01-01') where category='DEBT' and txn_type='EXPENSE' and currency='SDG')=16000
        and (select total from month_summary('2000-01-01','2100-01-01') where category='DEBT' and txn_type='INCOME'  and currency='SDG')=8100
        and (select total from month_summary('2000-01-01','2100-01-01') where category='DEBT' and txn_type='EXPENSE' and currency='AED')=100+210+10,
        'T3: month_summary reports DEBT buckets in WALLET currency (SDG 16000 out / 8100 in; AED 320 out)');
\echo ALL MULTI-CURRENCY DEBT TESTS PASSED
