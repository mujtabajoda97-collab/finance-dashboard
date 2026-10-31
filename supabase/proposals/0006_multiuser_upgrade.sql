-- =====================================================================
-- 0006 — Multi-user upgrade (unified, idempotent: safe to re-run).
--   1) Per-user Green API settings on public.profiles
--   2) Debt alert timing column (same meaning as tasks.remind_before_minutes)
--   3) Projects + project_cashflows with RLS
--   4) Secure reset function (requires a fresh email-OTP login, <= 5 minutes old)
-- Includes everything in 0005, so you do NOT need to run 0005 separately.
-- Run in: Supabase Dashboard -> SQL Editor.
-- =====================================================================

-- 1) Green API per user (readable/writable only by the owner through the existing profiles RLS)
alter table public.profiles add column if not exists green_api_id_instance    text;
alter table public.profiles add column if not exists green_api_token_instance text;
-- (profiles.whatsapp_phone already exists)

-- 2) Debt alert timing
alter table public.debts
  add column if not exists remind_before_minutes integer not null default 1440
  check (remind_before_minutes >= 0);

-- 3) Projects
create table if not exists public.projects (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name             text not null check (length(trim(name)) > 0),
  budget           numeric(14, 2) not null default 0 check (budget >= 0),
  currency         currency_code not null default 'AED',
  allocated_amount numeric(14, 2) not null default 0 check (allocated_amount >= 0),
  notes            text,
  is_archived      boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists projects_user_idx on public.projects (user_id);
drop trigger if exists trg_project_touch on public.projects;
create trigger trg_project_touch before update on public.projects
  for each row execute function public.touch_updated_at();

create table if not exists public.project_cashflows (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  direction  text not null check (direction in ('IN', 'OUT')),
  title      text not null check (length(trim(title)) > 0),
  amount     numeric(14, 2) not null default 0 check (amount >= 0),
  currency   currency_code not null default 'AED',
  due_date   date,
  is_done    boolean not null default false,
  debt_id    uuid references public.debts (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_cashflows_user_idx    on public.project_cashflows (user_id);
create index if not exists project_cashflows_project_idx on public.project_cashflows (project_id);
drop trigger if exists trg_project_cashflow_touch on public.project_cashflows;
create trigger trg_project_cashflow_touch before update on public.project_cashflows
  for each row execute function public.touch_updated_at();

alter table public.projects          enable row level security;
alter table public.project_cashflows enable row level security;
do $$
declare t text;
begin
  foreach t in array array['projects', 'project_cashflows'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- 4) Secure reset.
--    p_mode = 'transactions' : delete debts (+payments), transactions, alert log; wallets stay with zero balances.
--    p_mode = 'full'         : delete wallets, debts, tasks, projects, alert log (rates and profile stay).
--    Refuses to run unless the caller's session was created by an email-OTP login within the last 5 minutes
--    (the app asks for a fresh OTP right before calling this).
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

  -- payments first (they cascade to their linked transactions), then the rest of the transactions
  delete from public.debt_payments where user_id = uid;
  delete from public.transactions  where user_id = uid;
  get diagnostics n_tx = row_count;
  delete from public.debts         where user_id = uid;
  get diagnostics n_debts = row_count;

  if p_mode = 'transactions' then
    update public.wallets set opening_balance = 0, balance = 0 where user_id = uid;
  else
    delete from public.project_cashflows where user_id = uid;
    delete from public.projects          where user_id = uid;
    delete from public.tasks             where user_id = uid;
    delete from public.wallets           where user_id = uid;
    if to_regclass('public.budgets') is not null then
      execute 'delete from public.budgets where user_id = $1' using uid;
    end if;
  end if;

  delete from public.alert_logs where user_id = uid;

  return jsonb_build_object('ok', true, 'mode', p_mode, 'transactions_deleted', n_tx, 'debts_deleted', n_debts);
end $$;

revoke all on function public.reset_my_data(text) from public, anon;
grant execute on function public.reset_my_data(text) to authenticated;
