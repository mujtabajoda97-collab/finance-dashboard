-- =====================================================================
-- 0010 — (1) Full reset that really wipes everything + default exchange rate
--        (2) Pending inflows (expected money not received yet)
-- Run once in the Supabase SQL Editor. Safe to re-run (idempotent).
-- Needs 0001..0009 applied first.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) reset_my_data: BOTH modes now delete every financial record
--    transactions, debt payments/events, debts, projects + their items,
--    fund reservations, pending inflows, alert log, and reset the exchange
--    rate to the default (AED→USD 0.272294, same as a brand-new account).
--    p_mode = 'transactions' : wallets stay, balances become 0
--    p_mode = 'full'         : wallets and tasks are deleted too
--    Still requires an email-OTP login within the last 5 minutes.
-- ---------------------------------------------------------------------
create or replace function public.reset_my_data(p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid      uuid := auth.uid();
  fresh    boolean;
  n_tx     integer := 0;
  n_debts  integer := 0;
  n_proj   integer := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_mode not in ('transactions', 'full') then
    raise exception 'invalid mode' using errcode = '22023';
  end if;

  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) a
    where a ->> 'method' in ('otp', 'magiclink')
      and (a ->> 'timestamp')::bigint >= extract(epoch from now())::bigint - 300
  ) into fresh;
  if not fresh then
    raise exception 'fresh OTP confirmation required' using errcode = '42501';
  end if;

  -- reservations / pending inflows first (they reference wallets and projects)
  if to_regclass('public.fund_reservations') is not null then
    execute 'delete from public.fund_reservations where user_id = $1' using uid;
  end if;
  if to_regclass('public.pending_inflows') is not null then
    execute 'delete from public.pending_inflows where user_id = $1' using uid;
  end if;
  if to_regclass('public.debt_events') is not null then
    execute 'delete from public.debt_events where user_id = $1' using uid;
  end if;

  -- projects and their items (cashflows may point at debts: remove them before the debts)
  delete from public.project_cashflows where user_id = uid;
  delete from public.projects          where user_id = uid;
  get diagnostics n_proj = row_count;

  -- payments first (they cascade to their linked transactions), then the rest of the transactions
  delete from public.debt_payments where user_id = uid;
  delete from public.transactions  where user_id = uid;
  get diagnostics n_tx = row_count;
  delete from public.debts         where user_id = uid;
  get diagnostics n_debts = row_count;

  if p_mode = 'transactions' then
    update public.wallets set opening_balance = 0, balance = 0 where user_id = uid;
  else
    delete from public.tasks   where user_id = uid;
    delete from public.wallets where user_id = uid;
    if to_regclass('public.budgets') is not null then
      execute 'delete from public.budgets where user_id = $1' using uid;
    end if;
  end if;

  -- exchange rate back to the default instead of keeping the old value
  delete from public.exchange_rate_history where user_id = uid;
  delete from public.exchange_rates        where user_id = uid;
  insert into public.exchange_rates (user_id, base_currency, target_currency, rate)
  values (uid, 'AED', 'USD', 0.272294);

  delete from public.alert_logs where user_id = uid;

  return jsonb_build_object('ok', true, 'mode', p_mode,
    'transactions_deleted', n_tx, 'debts_deleted', n_debts, 'projects_deleted', n_proj);
end $$;

revoke all on function public.reset_my_data(text) from public, anon;
grant execute on function public.reset_my_data(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Pending inflows
-- ---------------------------------------------------------------------
create table if not exists public.pending_inflows (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount             numeric(14, 2) not null check (amount > 0),
  currency           currency_code not null default 'AED',
  description        text not null check (length(trim(description)) > 0),
  due_date           date,
  status             text not null default 'PENDING' check (status in ('PENDING', 'RECEIVED')),
  received_wallet_id uuid references public.wallets (id) on delete set null,
  received_at        timestamptz,
  project_id         uuid references public.projects (id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists pending_inflows_user_idx on public.pending_inflows (user_id, status, due_date);

alter table public.pending_inflows enable row level security;
drop policy if exists "own rows" on public.pending_inflows;
create policy "own rows" on public.pending_inflows
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.pending_inflows from anon;
grant select, insert, update, delete on public.pending_inflows to authenticated;

-- 3) "Received": post the amount to a wallet as a real INCOME and, optionally,
--    reserve it for a project (raises the project's allocated amount at once).
--    p_wallet must use the same currency as the inflow.
--    p_project_amount: the same amount converted to the project currency (only with p_project).
--    SECURITY INVOKER: row-level security applies; nobody can touch another user's rows.
create or replace function public.receive_pending_inflow(
  p_id             uuid,
  p_wallet         uuid,
  p_project        uuid    default null,
  p_project_amount numeric default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  i pending_inflows%rowtype;
  w wallets%rowtype;
begin
  select * into i from pending_inflows where id = p_id and status = 'PENDING' for update;
  if not found then
    raise exception 'Pending inflow not found or already received' using errcode = 'P0002';
  end if;

  select * into w from wallets where id = p_wallet;
  if not found then
    raise exception 'Wallet not found' using errcode = 'P0002';
  end if;
  if w.currency <> i.currency then
    raise exception 'Wallet currency (%) differs from the inflow currency (%)', w.currency, i.currency
      using errcode = '22023';
  end if;

  if p_project is not null then
    if p_project_amount is null or p_project_amount <= 0 then
      raise exception 'project amount is required' using errcode = '22023';
    end if;
    perform 1 from projects where id = p_project;
    if not found then
      raise exception 'Project not found' using errcode = 'P0002';
    end if;
  end if;

  -- the wallet balance is updated by the existing transaction trigger
  insert into transactions (wallet_id, type, category, amount, notes, date)
  values (p_wallet, 'INCOME', 'GENERAL', i.amount, i.description, now());

  if p_project is not null then
    insert into fund_reservations (project_id, wallet_id, amount, project_amount)
    values (p_project, p_wallet, i.amount, round(p_project_amount, 2));
    update projects set allocated_amount = allocated_amount + round(p_project_amount, 2) where id = p_project;
  end if;

  update pending_inflows
     set status = 'RECEIVED', received_wallet_id = p_wallet, received_at = now(), project_id = p_project
   where id = p_id;

  return jsonb_build_object('ok', true, 'amount', i.amount, 'wallet', p_wallet, 'project', p_project);
end $$;

revoke all on function public.receive_pending_inflow(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.receive_pending_inflow(uuid, uuid, uuid, numeric) to authenticated;
