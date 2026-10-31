-- =====================================================================
-- ROLLBACK for migration 0003 — PROPOSED, NOT APPLIED. Run only if 0003 must be undone.
--
-- !!! READ BEFORE RUNNING — THE APP MUST BE ROLLED BACK FIRST !!!
--   1. In Vercel set NEXT_PUBLIC_SCHEMA_V3 to 0 (or remove it) for Preview AND Production, redeploy, and wait
--      until no deployment built with NEXT_PUBLIC_SCHEMA_V3=1 is serving traffic. The flag is baked into the
--      JavaScript bundle at build time, so changing the variable alone does nothing.
--   2. Why this matters:
--      a) Idempotency. Level A drops the client_request_id unique indexes, so a retried request can post twice.
--         After Level B the columns are gone and EVERY insert that still sends client_request_id fails.
--      b) MULTI-CURRENCY DEBT REPAYMENT (the dangerous one). 0003 posts debt_payments.wallet_amount (the wallet's
--         currency) to the wallet. The 0001 body posts `amount` (the DEBT's currency) whatever the wallet's
--         currency is. Without 0003 a 16,000 SDG installment paid from an AED wallet debits 16,000 AED instead
--         of 100 AED, and a 100 AED installment paid from an SDG wallet debits 100 SDG instead of 16,000 SDG.
--         A client that still sends wallet_amount is silently ignored.
--   3. Therefore Level A restores the 0001 posting body PLUS ONE GUARD (clearly marked below): installments whose
--      wallet currency differs from the debt currency are REJECTED while 0003 is rolled back. Same-currency
--      payments behave exactly as in 0001. Any debt-payment screen that offers a wallet of another currency
--      must be hidden or disabled in the rolled-back app version.
--   4. Payments already recorded under 0003 are not touched: their wallet transactions keep the amounts that
--      were posted, and deleting them later still reverses exactly those amounts.
--   5. Re-enable NEXT_PUBLIC_SCHEMA_V3 only after 0003 has been applied again and verified.
--   6. As a forcing function Level A refuses to run unless the session first executes the line marked
--      "CONFIRM" below (uncomment it once you have done step 1).
--
-- Design rules
--   * The security fix of 0003 §8 (search_path = public, pg_temp on every SECURITY DEFINER function)
--     is DELIBERATELY KEPT. This script never sets search_path back to plain "public".
--   * LEVEL A (functional rollback) removes every trigger / function / view / index that changes behaviour,
--     and restores the 0001 body of debt_payment_after_insert (hardened search_path) plus the guard of
--     point 3. It deletes NO table, NO column and NO row, so it is always safe.
--   * LEVEL B (structural rollback) drops the columns and the budgets table that 0003 added. It is guarded:
--     it refuses to run if any of them holds data (those columns/rows would be lost). Take a backup first.
--   * Run A, verify the app, and only then consider B.
-- =====================================================================

-- CONFIRM (uncomment after the app no longer sends NEXT_PUBLIC_SCHEMA_V3=1 requests):
-- set rollback.ui_disabled = 'yes';

-- ============================ LEVEL A ================================
begin;

-- 0. precondition + preflight (read-only)
do $$
declare cross_n bigint; req_n bigint;
begin
  if coalesce(current_setting('rollback.ui_disabled', true), '') <> 'yes' then
    raise exception 'ROLLBACK REFUSED: roll the app back first (NEXT_PUBLIC_SCHEMA_V3=0 + redeploy), then uncomment the CONFIRM line at the top of this file';
  end if;
  select count(*) into cross_n from public.debt_payments where wallet_amount is not null and wallet_amount <> amount;
  select count(*) into req_n from public.transactions where client_request_id is not null;
  raise notice 'preflight: % cross-currency debt payment(s) and % transaction(s) with client_request_id exist (kept; not modified)', cross_n, req_n;
end $$;

-- 1. behaviour added by 0003: triggers first, then their functions
drop trigger if exists trg_transaction_validate        on public.transactions;
drop trigger if exists trg_debt_payment_before_insert  on public.debt_payments;
drop trigger if exists trg_debt_before_update          on public.debts;
drop trigger if exists trg_wallet_currency_lock        on public.wallets;
drop function if exists public.transaction_validate();
drop function if exists public.debt_payment_before_insert();
drop function if exists public.debt_before_update();
drop function if exists public.wallet_currency_lock();

-- 2. read-side objects
drop view     if exists public.wallet_reconciliation;
drop function if exists public.recompute_wallet_balances(uuid);
drop function if exists public.wallet_expected_balance(uuid);
drop function if exists public.month_summary(timestamptz, timestamptz);

-- 3. restore the 0001 body of debt_payment_after_insert (same trigger name, still attached) + the cross-currency GUARD,
--    but keep the hardened search_path.
create or replace function public.debt_payment_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d  debts%rowtype;
  wc currency_code;
begin
  select * into d from debts where id = new.debt_id and user_id = new.user_id;
  if not found then
    raise exception 'Debt not found';
  end if;
  -- GUARD (the only difference from the 0001 body): 0001 posts `amount` (debt currency) to the wallet
  -- whatever its currency, which would corrupt balances. Reject cross-currency installments instead.
  select currency into wc from wallets where id = new.wallet_id and user_id = new.user_id;
  if wc is distinct from d.currency then
    raise exception 'Cross-currency debt payments are disabled while migration 0003 is rolled back (wallet %, debt %)', wc, d.currency;
  end if;
  if d.paid_amount + new.amount > d.total_amount then
    raise exception 'Payment exceeds remaining amount (%).', d.total_amount - d.paid_amount;
  end if;

  insert into transactions (user_id, wallet_id, type, category, amount, notes, date, debt_payment_id)
  values (
    new.user_id, new.wallet_id,
    case when d.type = 'RECEIVABLE' then 'INCOME'::txn_type else 'EXPENSE'::txn_type end,
    'DEBT', new.amount,
    coalesce(new.notes, format('دفعة دين — %s', d.person_name)),
    new.payment_date, new.id
  );

  perform debt_recalc(new.debt_id);
  return new;
end $$;
revoke execute on function public.debt_payment_after_insert() from public, anon, authenticated;

-- 4. the idempotency indexes only matter to the new UI; dropping them is lossless
drop index if exists public.transactions_client_req_uniq;
drop index if exists public.debt_payments_client_req_uniq;

-- 5. verification: no 0003 behaviour left, security fix still present
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not (coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp']);
  if bad is not null then
    raise exception 'ROLLBACK ABORTED: SECURITY DEFINER functions without hardened search_path: %', bad;
  end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_transaction_validate','trg_debt_payment_before_insert',
                                                        'trg_debt_before_update','trg_wallet_currency_lock')) then
    raise exception 'ROLLBACK ABORTED: a 0003 trigger is still present';
  end if;
end $$;
commit;

-- ============================ LEVEL B ================================
-- OPTIONAL. Structural removal; guarded against data loss. Run in a separate transaction after A.
-- begin;
-- do $$
-- begin
--   if exists (select 1 from public.budgets) then
--     raise exception 'budgets has rows - export them first (select * from public.budgets)';
--   end if;
--   if exists (select 1 from public.transactions where client_request_id is not null)
--      or exists (select 1 from public.debt_payments
--                  where client_request_id is not null or wallet_amount is not null or exchange_rate_used is not null) then
--     raise exception 'client_request_id / wallet_amount / exchange_rate_used hold data - they would be lost';
--   end if;
-- end $$;
-- drop table if exists public.budgets;
-- alter table public.debt_payments drop constraint if exists debt_payments_wallet_amount_pos;
-- alter table public.debt_payments drop column if exists client_request_id,
--                                  drop column if exists wallet_amount,
--                                  drop column if exists exchange_rate_used;
-- alter table public.transactions drop column if exists client_request_id;
-- commit;
