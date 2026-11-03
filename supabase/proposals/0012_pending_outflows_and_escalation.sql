-- =====================================================================
-- 0012 — Pending outflows + WhatsApp escalation
--   1) pending_outflows  : bills / rent that are due but not paid yet, with a one-tap "paid" that posts a real EXPENSE
--   2) wa_inbox          : important flag + escalated_at (so an unanswered important reply is escalated only once)
--   3) profiles          : emergency phone + minutes to wait before escalating
-- Run once in the Supabase SQL Editor. Safe to re-run. Does not touch existing data.
-- =====================================================================

-- ---------- 1) pending outflows ----------
create table if not exists public.pending_outflows (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount           numeric(14, 2) not null check (amount > 0),
  currency         currency_code not null default 'AED',
  description      text not null check (length(trim(description)) > 0),
  category         text not null default 'BILLS',
  due_date         date,
  wallet_id        uuid references public.wallets (id) on delete set null,   -- wallet expected to pay it
  status           text not null default 'PENDING' check (status in ('PENDING', 'PAID')),
  paid_wallet_id   uuid references public.wallets (id) on delete set null,
  paid_at          timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists pending_outflows_user_idx on public.pending_outflows (user_id, status, due_date);

alter table public.pending_outflows enable row level security;
drop policy if exists "own rows" on public.pending_outflows;
create policy "own rows" on public.pending_outflows
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.pending_outflows from anon;
grant select, insert, update, delete on public.pending_outflows to authenticated;

-- "Paid": post the amount as a real EXPENSE from the chosen wallet (same currency) and close the item.
-- The wallet balance is updated by the existing transaction trigger. SECURITY INVOKER: row-level security applies.
create or replace function public.pay_pending_outflow(p_id uuid, p_wallet uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  o pending_outflows%rowtype;
  w wallets%rowtype;
begin
  select * into o from pending_outflows where id = p_id and status = 'PENDING' for update;
  if not found then
    raise exception 'Pending outflow not found or already paid' using errcode = 'P0002';
  end if;
  select * into w from wallets where id = p_wallet;
  if not found then
    raise exception 'Wallet not found' using errcode = 'P0002';
  end if;
  if w.currency <> o.currency then
    raise exception 'Wallet currency (%) differs from the bill currency (%)', w.currency, o.currency using errcode = '22023';
  end if;
  if w.balance < o.amount then
    raise exception 'Insufficient wallet balance' using errcode = '23514';
  end if;

  insert into transactions (wallet_id, type, category, amount, notes, date)
  values (p_wallet, 'EXPENSE', coalesce(nullif(o.category, ''), 'GENERAL'), o.amount, o.description, now());

  update pending_outflows set status = 'PAID', paid_wallet_id = p_wallet, paid_at = now() where id = p_id;
  return jsonb_build_object('ok', true, 'amount', o.amount, 'wallet', p_wallet);
end $$;

revoke all on function public.pay_pending_outflow(uuid, uuid) from public, anon;
grant execute on function public.pay_pending_outflow(uuid, uuid) to authenticated;

-- ---------- 2) WhatsApp escalation ----------
alter table public.wa_inbox add column if not exists important    boolean not null default false;
alter table public.wa_inbox add column if not exists escalated_at timestamptz;
create index if not exists wa_inbox_escalate on public.wa_inbox (important, handled, escalated_at, created_at);

-- ---------- 3) Emergency contact ----------
alter table public.profiles add column if not exists emergency_phone       text;
alter table public.profiles add column if not exists escalate_after_minutes integer not null default 60
  check (escalate_after_minutes between 5 and 1440);
