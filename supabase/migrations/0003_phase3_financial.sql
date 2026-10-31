-- =====================================================================
-- My Life OS — Phase 3 (Financial Management) — migration 0003
--
-- STATUS: PROPOSED. NOT APPLIED to any database. Review before applying.
--
-- Safety properties of this file
--   * ADDITIVE ONLY: no table/column/row is dropped, renamed or rewritten.
--     No existing data is modified (no UPDATE/DELETE of rows anywhere).
--   * Re-runnable: every statement is IF NOT EXISTS / CREATE OR REPLACE.
--   * Existing triggers are kept; only function bodies of the debt-payment
--     trigger are replaced (same trigger names), and new triggers are added.
--   * Legacy rows keep working: new columns are NULLable.
--
-- What it adds
--   1. Idempotency keys (client_request_id) on transactions & debt_payments
--      -> a double tap / network retry can never post the same operation twice.
--   2. Validation of wallet-to-wallet transfers (cross-currency needs to_amount,
--      no posting to archived wallets) so a transfer can never debit without a
--      matching credit in the right currency.
--   3. Debt payments: row lock (no double-spend race), payment currency vs wallet
--      currency (wallet_amount), clients can no longer hand-edit paid_amount/status.
--   4. Wallet currency is frozen once the wallet has history.
--   5. budgets table (monthly caps in AED, overall or per category).
--   6. month_summary() RPC: exact month totals in the database (no row limit).
--   7. wallet_reconciliation view + service-only repair function.
--   8. search_path hardening (public, pg_temp) of every SECURITY DEFINER function
--      (0001's included, via ALTER FUNCTION: metadata only, bodies untouched).
--
-- Relies on 0001 (tables, enums, debt_recalc, touch_updated_at, triggers).
-- 0001 already enforces CHECK (to_wallet_id <> wallet_id) and
-- CHECK (to_wallet_id IS NULL OR type = 'TRANSFER'); this file repeats both inside
-- transaction_validate only to give a clear error message before the CHECK fires.
-- =====================================================================

-- Guard: the balance logic below assumes exactly these three transaction types.
do $$
declare v text;
begin
  select string_agg(e.enumlabel, ',' order by e.enumlabel) into v
    from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'txn_type' and t.typnamespace = 'public'::regnamespace;
  if v is distinct from 'EXPENSE,INCOME,TRANSFER' then
    raise exception 'txn_type has unexpected labels (%); review balance logic before applying 0003', v;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. Idempotency keys
-- ---------------------------------------------------------------------
alter table public.transactions
  add column if not exists client_request_id uuid;
alter table public.debt_payments
  add column if not exists client_request_id uuid,
  add column if not exists wallet_amount numeric(14, 2),
  add column if not exists exchange_rate_used numeric(18, 6);

-- NULLs are distinct in a unique index, so legacy rows (NULL) never collide.
create unique index if not exists transactions_client_req_uniq
  on public.transactions (user_id, client_request_id);
create unique index if not exists debt_payments_client_req_uniq
  on public.debt_payments (user_id, client_request_id);

do $$ begin
  alter table public.debt_payments
    add constraint debt_payments_wallet_amount_pos check (wallet_amount is null or wallet_amount > 0);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. Transaction validation (runs BEFORE the balance trigger)
-- ---------------------------------------------------------------------
create or replace function public.transaction_validate()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w  wallets%rowtype;
  tw wallets%rowtype;
begin
  select * into w from wallets where id = new.wallet_id and user_id = new.user_id;
  if not found then
    raise exception 'Wallet not found';
  end if;
  if w.is_archived and (tg_op = 'INSERT' or new.wallet_id is distinct from old.wallet_id) then
    raise exception 'Wallet "%" is archived', w.name;
  end if;

  if new.to_wallet_id is not null and new.to_wallet_id = new.wallet_id then
    raise exception 'Cannot transfer from a wallet to itself';
  end if;
  if new.to_wallet_id is not null and new.type <> 'TRANSFER' then
    raise exception 'to_wallet_id applies only to wallet-to-wallet transfers';
  end if;

  if new.type <> 'TRANSFER' or new.to_wallet_id is null then
    if new.to_amount is not null then
      raise exception 'to_amount applies only to wallet-to-wallet transfers';
    end if;
  else
    select * into tw from wallets where id = new.to_wallet_id and user_id = new.user_id;
    if not found then
      raise exception 'Destination wallet not found';
    end if;
    if tw.is_archived and (tg_op = 'INSERT' or new.to_wallet_id is distinct from old.to_wallet_id) then
      raise exception 'Wallet "%" is archived', tw.name;
    end if;
    if tw.currency <> w.currency and new.to_amount is null then
      raise exception 'to_amount (amount received in %) is required when wallets use different currencies', tw.currency;
    end if;
    if tw.currency = w.currency and new.to_amount is not null and new.to_amount <> new.amount then
      raise exception 'to_amount must equal amount when both wallets use the same currency';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_transaction_validate on public.transactions;
create trigger trg_transaction_validate
  before insert or update on public.transactions
  for each row execute function public.transaction_validate();

-- ---------------------------------------------------------------------
-- 3. Debt payments
-- ---------------------------------------------------------------------
-- BEFORE INSERT: lock the debt row (serialises concurrent payments), validate the
-- remaining amount, and resolve the amount that hits the wallet.
create or replace function public.debt_payment_before_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d debts%rowtype;
  w wallets%rowtype;
begin
  select * into d from debts where id = new.debt_id and user_id = new.user_id for update;
  if not found then
    raise exception 'Debt not found';
  end if;
  select * into w from wallets where id = new.wallet_id and user_id = new.user_id;
  if not found then
    raise exception 'Wallet not found';
  end if;
  if w.is_archived then
    raise exception 'Wallet "%" is archived', w.name;
  end if;
  if d.status = 'PAID' or d.paid_amount + new.amount > d.total_amount then
    raise exception 'Payment exceeds remaining amount (%).', d.total_amount - d.paid_amount;
  end if;

  if w.currency = d.currency then
    if new.wallet_amount is not null and new.wallet_amount <> new.amount then
      raise exception 'wallet_amount must equal amount when the wallet and the debt use the same currency';
    end if;
    new.wallet_amount := new.amount;
    new.exchange_rate_used := null;
  else
    if new.wallet_amount is null then
      raise exception 'wallet_amount (in %) is required when paying a % debt from a % wallet',
        w.currency, d.currency, w.currency;
    end if;
    new.exchange_rate_used := round(new.wallet_amount / new.amount, 6);
  end if;
  return new;
end $$;

drop trigger if exists trg_debt_payment_before_insert on public.debt_payments;
create trigger trg_debt_payment_before_insert
  before insert on public.debt_payments
  for each row execute function public.debt_payment_before_insert();

-- AFTER INSERT (replaces the 0001 body, same trigger name): post the wallet
-- transaction using the resolved wallet amount. Category stays 'DEBT' so the
-- app never counts a repayment as ordinary income / expense.
create or replace function public.debt_payment_after_insert()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d debts%rowtype;
begin
  select * into d from debts where id = new.debt_id and user_id = new.user_id;
  if not found then
    raise exception 'Debt not found';
  end if;

  insert into transactions (user_id, wallet_id, type, category, amount,
                            original_amount, original_currency, exchange_rate_used,
                            notes, date, debt_payment_id)
  values (
    new.user_id, new.wallet_id,
    case when d.type = 'RECEIVABLE' then 'INCOME'::txn_type else 'EXPENSE'::txn_type end,
    'DEBT', coalesce(new.wallet_amount, new.amount),
    case when new.exchange_rate_used is not null then new.amount end,
    case when new.exchange_rate_used is not null then d.currency end,
    new.exchange_rate_used,
    coalesce(new.notes, format('دفعة دين — %s', d.person_name)),
    new.payment_date, new.id
  );

  perform debt_recalc(new.debt_id);
  return new;
end $$;

-- Debts: clients cannot hand-edit progress; type/currency are frozen once a
-- payment exists; changing the total re-derives the status.
create or replace function public.debt_before_update()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- Progress is derived from the installments (debt_recalc, SECURITY DEFINER, runs as the
  -- function owner). API callers may not set it by hand.
  if current_user in ('authenticated', 'anon')
     and (new.paid_amount is distinct from old.paid_amount or new.status is distinct from old.status) then
    raise exception 'paid_amount and status are maintained automatically from the installments';
  end if;

  if (new.type is distinct from old.type or new.currency is distinct from old.currency)
     and exists (select 1 from debt_payments where debt_id = old.id) then
    raise exception 'Cannot change the type or currency of a debt that already has payments';
  end if;

  if new.total_amount is distinct from old.total_amount then
    if new.total_amount < new.paid_amount then
      raise exception 'Total (%) cannot be less than the amount already paid (%)', new.total_amount, new.paid_amount;
    end if;
    new.status := case when new.paid_amount = 0 then 'OPEN'::debt_status
                       when new.paid_amount >= new.total_amount then 'PAID'::debt_status
                       else 'PARTIAL'::debt_status end;
  end if;
  return new;
end $$;

drop trigger if exists trg_debt_before_update on public.debts;
create trigger trg_debt_before_update
  before update on public.debts
  for each row execute function public.debt_before_update();

-- ---------------------------------------------------------------------
-- 4. Wallet currency is frozen once the wallet has history
-- ---------------------------------------------------------------------
create or replace function public.wallet_currency_lock()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.currency is distinct from old.currency and (
       exists (select 1 from transactions where wallet_id = old.id or to_wallet_id = old.id)
       or exists (select 1 from debt_payments where wallet_id = old.id)) then
    raise exception 'Cannot change the currency of a wallet that already has transactions';
  end if;
  return new;
end $$;

drop trigger if exists trg_wallet_currency_lock on public.wallets;
create trigger trg_wallet_currency_lock
  before update of currency on public.wallets
  for each row execute function public.wallet_currency_lock();

-- ---------------------------------------------------------------------
-- 5. Budgets (monthly caps, expressed in AED — the app's reporting currency)
-- ---------------------------------------------------------------------
create table if not exists public.budgets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category         text check (category is null or length(trim(category)) > 0), -- NULL = overall cap
  limit_aed        numeric(14, 2) not null check (limit_aed > 0),
  alert_at_percent integer not null default 80 check (alert_at_percent between 1 and 100),
  is_active        boolean not null default true,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
-- Two partial indexes (instead of coalesce(category,'*')): a real category can never
-- collide with the "overall" budget, whatever its name.
create unique index if not exists budgets_user_category_uniq
  on public.budgets (user_id, category) where category is not null;
create unique index if not exists budgets_user_overall_uniq
  on public.budgets (user_id) where category is null;

drop trigger if exists trg_budget_touch on public.budgets;
create trigger trg_budget_touch
  before update on public.budgets
  for each row execute function public.touch_updated_at();

-- Supabase's default privileges hand every new public table to anon/authenticated/service_role
-- with ALL rights. 0001 trims TRUNCATE/TRIGGER/REFERENCES only for tables that existed then,
-- so do the same for this new table, and give anon nothing at all (RLS already denies it).
revoke all on public.budgets from anon;
revoke truncate, trigger, references on public.budgets from authenticated;

alter table public.budgets enable row level security;
drop policy if exists "own rows" on public.budgets;
create policy "own rows" on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- 6. month_summary(): exact totals, computed in the database
--    SECURITY INVOKER -> RLS applies; it can only ever see the caller's rows.
--    Returns raw buckets; the app converts to AED with the same rules as
--    src/lib/stats.ts (DEBT excluded, internal transfers skipped, Sudan separate).
-- ---------------------------------------------------------------------
create or replace function public.month_summary(p_from timestamptz, p_to timestamptz)
returns table (txn_type text, category text, currency text, total numeric, n bigint)
language sql stable security invoker set search_path = public, pg_temp as $$
  select t.type::text, t.category, w.currency::text, sum(t.amount), count(*)
    from public.transactions t
    join public.wallets w on w.id = t.wallet_id
   where t.date >= p_from and t.date < p_to
   group by 1, 2, 3;
$$;
revoke execute on function public.month_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.month_summary(timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- 7. Reconciliation: stored balance vs. what the history says it should be
--    Mirrors apply_transaction() (0001) type by type, with NO catch-all branch:
--      INCOME   : wallet_id      +amount
--      EXPENSE  : wallet_id      -amount
--      TRANSFER : wallet_id      -amount ; to_wallet_id +coalesce(to_amount, amount)
--                 (a Sudan transfer has no to_wallet_id: debit only)
--    Debt repayments are ordinary INCOME/EXPENSE rows (category 'DEBT') for the balance;
--    only the month report excludes them.
-- ---------------------------------------------------------------------
create or replace function public.wallet_expected_balance(p_wallet uuid)
returns numeric language sql stable security invoker set search_path = public, pg_temp as $$
  select w.opening_balance + coalesce((
    select sum(e.delta) from (
      select case t.type
               when 'INCOME'   then  t.amount
               when 'EXPENSE'  then -t.amount
               when 'TRANSFER' then -t.amount
             end as delta
        from transactions t where t.wallet_id = p_wallet
      union all
      select coalesce(t.to_amount, t.amount)
        from transactions t where t.to_wallet_id = p_wallet and t.type = 'TRANSFER'
    ) e), 0)
  from wallets w where w.id = p_wallet
$$;
revoke execute on function public.wallet_expected_balance(uuid) from public, anon;
grant execute on function public.wallet_expected_balance(uuid) to authenticated, service_role;

create or replace view public.wallet_reconciliation
with (security_invoker = true) as
select w.id as wallet_id, w.user_id, w.name, w.currency, w.balance,
       public.wallet_expected_balance(w.id)             as expected_balance,
       w.balance - public.wallet_expected_balance(w.id) as drift
  from public.wallets w;
revoke all on public.wallet_reconciliation from public, anon, authenticated;
grant select on public.wallet_reconciliation to authenticated, service_role;

-- Repair tool. SECURITY INVOKER on purpose: it only works for a role that can already
-- update wallets for every user (service_role bypasses RLS), so no privilege is borrowed.
create or replace function public.recompute_wallet_balances(p_user uuid default null)
returns integer language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  v_fixed integer := 0;
  r record;
begin
  for r in
    select w.id, public.wallet_expected_balance(w.id) as expected
      from wallets w
     where (p_user is null or w.user_id = p_user)
       and w.balance is distinct from public.wallet_expected_balance(w.id)
  loop
    update wallets set balance = r.expected where id = r.id;
    v_fixed := v_fixed + 1;
  end loop;
  return v_fixed;
end $$;
revoke execute on function public.recompute_wallet_balances(uuid) from public, anon, authenticated;
grant execute on function public.recompute_wallet_balances(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Hardening: trigger functions are never callable through the API
-- ---------------------------------------------------------------------
revoke execute on function public.transaction_validate() from public, anon, authenticated;
revoke execute on function public.debt_payment_before_insert() from public, anon, authenticated;
revoke execute on function public.debt_payment_after_insert() from public, anon, authenticated;
revoke execute on function public.debt_before_update() from public, anon, authenticated;
revoke execute on function public.wallet_currency_lock() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8. search_path hardening of the SECURITY DEFINER functions created by 0001.
--    With "set search_path = public" PostgreSQL still searches the session's pg_temp
--    schema FIRST for tables, so any signed-in user could create a TEMP table named
--    "wallets" and make these functions read/update it instead of the real table
--    (e.g. record an expense without the real wallet being debited). Listing pg_temp
--    explicitly last removes that. Metadata only: bodies and behaviour are unchanged.
-- ---------------------------------------------------------------------
alter function public.wallet_low_balance_alert()                set search_path = public, pg_temp;
alter function public.apply_transaction(public.transactions, integer) set search_path = public, pg_temp;
alter function public.transaction_balance_sync()                set search_path = public, pg_temp;
alter function public.exchange_rate_log()                       set search_path = public, pg_temp;
alter function public.debt_recalc(uuid)                         set search_path = public, pg_temp;
alter function public.debt_payment_after_remove()               set search_path = public, pg_temp;
alter function public.task_spawn_next()                         set search_path = public, pg_temp;
alter function public.handle_new_user()                         set search_path = public, pg_temp;
alter function public.generate_due_alerts(interval)             set search_path = public, pg_temp;
alter function public.generate_overdue_digest()                 set search_path = public, pg_temp;
