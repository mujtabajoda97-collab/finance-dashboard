-- =====================================================================
-- 0005 — Projects & future cash flows + debt alert timing
-- Run once in the Supabase SQL Editor. Idempotent (safe to re-run).
-- =====================================================================

-- 1) Debt alert timing (same meaning as tasks.remind_before_minutes)
alter table public.debts
  add column if not exists remind_before_minutes integer not null default 1440
  check (remind_before_minutes >= 0);

-- 2) projects
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
create trigger trg_project_touch
  before update on public.projects
  for each row execute function public.touch_updated_at();

-- 3) project_cashflows (OUT = expected expense, IN = expected income / linked debt)
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
create trigger trg_project_cashflow_touch
  before update on public.project_cashflows
  for each row execute function public.touch_updated_at();

-- 4) Row Level Security (owner-only, same pattern as 0001)
alter table public.projects          enable row level security;
alter table public.project_cashflows enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['projects', 'project_cashflows']
  loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
