-- =====================================================================
-- 0009 — (1) increase an existing debt with a real wallet movement + history,
--        (2) per-item voice-alarm switch on tasks, debts and project items.
-- Run once in Supabase -> SQL Editor (after 0007 and 0008). Idempotent (safe to re-run).
-- Existing rows, triggers and policies are not changed.
-- =====================================================================

-- 1) Alarm switch (default off). The app schedules the native alarm from these flags.
alter table public.tasks          add column if not exists alarm_enabled boolean not null default false;
alter table public.debts          add column if not exists alarm_enabled boolean not null default false;
alter table public.project_cashflows add column if not exists alarm_enabled boolean not null default false;

-- 2) Debt history: one row per increase (payments already live in debt_payments).
create table if not exists public.debt_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id        uuid not null references public.debts (id) on delete cascade,
  kind           text not null check (kind in ('INCREASE')),
  amount         numeric(14, 2) not null check (amount > 0),
  wallet_id      uuid references public.wallets (id) on delete set null,
  transaction_id uuid references public.transactions (id) on delete set null,
  total_before   numeric(14, 2) not null,
  total_after    numeric(14, 2) not null,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists debt_events_user_idx on public.debt_events (user_id);
create index if not exists debt_events_debt_idx on public.debt_events (debt_id, created_at);

alter table public.debt_events enable row level security;
drop policy if exists "own rows read" on public.debt_events;
create policy "own rows read" on public.debt_events
  for select to authenticated using (user_id = auth.uid());
revoke all on public.debt_events from anon;
revoke insert, update, delete on public.debt_events from authenticated;
grant select on public.debt_events to authenticated;

-- 3) Increase an open debt.
--    RECEIVABLE (someone owes you): you lend more  -> money LEAVES the wallet (expense, category DEBT)
--    PAYABLE    (you owe someone) : you borrow more -> money ENTERS the wallet (income,  category DEBT)
--    The wallet must use the debt's currency. Category DEBT keeps it out of ordinary income/expense totals,
--    exactly like instalments. SECURITY DEFINER with explicit ownership checks (auth.uid()), because
--    debt totals/status are maintained by the database and clients may not edit them directly.
create or replace function public.debt_increase(
  p_debt   uuid,
  p_wallet uuid,
  p_amount numeric,
  p_note   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid      uuid := auth.uid();
  d        debts%rowtype;
  w        wallets%rowtype;
  amt      numeric(14, 2);
  reserved numeric := 0;
  before_t numeric(14, 2);
  tid      uuid;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  amt := round(p_amount, 2);

  select * into d from debts where id = p_debt and user_id = uid for update;
  if not found then
    raise exception 'Debt not found' using errcode = 'P0002';
  end if;
  if d.status = 'PAID' then
    raise exception 'This debt is already settled; create a new debt instead' using errcode = '22023';
  end if;

  select * into w from wallets where id = p_wallet and user_id = uid for update;
  if not found then
    raise exception 'Wallet not found' using errcode = 'P0002';
  end if;
  if w.is_archived then
    raise exception 'Wallet "%" is archived', w.name using errcode = '22023';
  end if;
  if w.currency <> d.currency then
    raise exception 'The wallet currency (%) must match the debt currency (%)', w.currency, d.currency
      using errcode = '22023';
  end if;

  if d.type = 'RECEIVABLE' then
    -- money leaves the wallet: respect funds reserved for projects (SQL 0008), if installed
    if to_regclass('public.fund_reservations') is not null then
      execute 'select coalesce(sum(amount), 0) from public.fund_reservations where wallet_id = $1 and user_id = $2'
        into reserved using p_wallet, uid;
    end if;
    if w.balance - reserved < amt then
      raise exception 'Insufficient free balance in "%"', w.name using errcode = '23514';
    end if;
  end if;

  insert into transactions (user_id, wallet_id, type, category, amount, notes)
  values (
    uid, p_wallet,
    case when d.type = 'RECEIVABLE' then 'EXPENSE'::txn_type else 'INCOME'::txn_type end,
    'DEBT', amt,
    coalesce(nullif(trim(p_note), ''), format('زيادة دين — %s', d.person_name))
  )
  returning id into tid;

  before_t := d.total_amount;
  update debts set total_amount = total_amount + amt where id = p_debt;
  perform debt_recalc(p_debt);

  insert into debt_events (user_id, debt_id, kind, amount, wallet_id, transaction_id, total_before, total_after, note)
  values (uid, p_debt, 'INCREASE', amt, p_wallet, tid, before_t, before_t + amt, nullif(trim(p_note), ''));

  return jsonb_build_object('ok', true, 'transaction_id', tid, 'total_before', before_t, 'total_after', before_t + amt);
end $$;

revoke all on function public.debt_increase(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.debt_increase(uuid, uuid, numeric, text) to authenticated;
