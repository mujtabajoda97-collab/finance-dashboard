-- =====================================================================
-- 0007 — Project accounting: target date, partial payments, executed spending.
-- Run once in Supabase -> SQL Editor (after 0006). Idempotent (safe to re-run).
-- =====================================================================

-- 1) Event / goal date for the coverage indicator
alter table public.projects
  add column if not exists target_date date;

-- 2) Amount already paid (OUT) or received (IN) on each cash-flow item
alter table public.project_cashflows
  add column if not exists paid_amount numeric(14, 2) not null default 0 check (paid_amount >= 0);

-- Items that were already ticked as done count as fully paid
update public.project_cashflows
   set paid_amount = amount
 where is_done and paid_amount = 0;

-- 3) Record a (partial) payment atomically.
--    p_amount : paid/received now, in the item's currency
--    p_alloc  : the same amount converted to the project currency (used for IN items only,
--               it is added to the project's set-aside amount in the same transaction)
--    SECURITY INVOKER: row-level security still applies, nobody can touch another user's rows.
create or replace function public.project_receive(p_flow uuid, p_amount numeric, p_alloc numeric default 0)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  f public.project_cashflows%rowtype;
  new_paid numeric(14, 2);
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  if p_alloc is null or p_alloc < 0 then
    raise exception 'invalid allocation' using errcode = '22023';
  end if;

  select * into f from public.project_cashflows where id = p_flow for update;
  if not found then
    raise exception 'cash-flow item not found' using errcode = 'P0002';
  end if;

  new_paid := least(f.amount, coalesce(f.paid_amount, 0) + p_amount);
  if coalesce(f.paid_amount, 0) + p_amount > f.amount + 0.004 then
    raise exception 'payment exceeds the remaining amount' using errcode = '22003';
  end if;

  update public.project_cashflows
     set paid_amount = new_paid,
         is_done     = (new_paid >= amount)
   where id = p_flow;

  if f.direction = 'IN' and p_alloc > 0 then
    update public.projects
       set allocated_amount = allocated_amount + p_alloc
     where id = f.project_id;
  end if;

  return jsonb_build_object('ok', true, 'paid_amount', new_paid, 'done', new_paid >= f.amount);
end $$;

revoke all on function public.project_receive(uuid, numeric, numeric) from public, anon;
grant execute on function public.project_receive(uuid, numeric, numeric) to authenticated;
