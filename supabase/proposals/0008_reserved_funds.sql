-- =====================================================================
-- 0008 — Reserved funds, debt payments routed to projects, project spending from wallets.
-- Run once in Supabase -> SQL Editor AFTER 0007. Idempotent (safe to re-run).
-- Nothing here changes existing rows or existing triggers.
-- =====================================================================

-- 1) Funds reserved for a project inside a wallet.
--    amount          : in the WALLET currency   (wallet free balance = balance - sum(amount))
--    project_amount  : same money in the PROJECT currency (what was added to "allocated")
create table if not exists public.fund_reservations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  project_id      uuid not null references public.projects (id) on delete cascade,
  wallet_id       uuid not null references public.wallets (id) on delete cascade,
  debt_payment_id uuid references public.debt_payments (id) on delete set null,
  amount          numeric(14, 2) not null check (amount > 0),
  project_amount  numeric(14, 2) not null check (project_amount >= 0),
  created_at      timestamptz not null default now()
);
create index if not exists fund_reservations_user_idx    on public.fund_reservations (user_id);
create index if not exists fund_reservations_wallet_idx  on public.fund_reservations (wallet_id);
create index if not exists fund_reservations_project_idx on public.fund_reservations (project_id);

alter table public.fund_reservations enable row level security;
drop policy if exists "own rows" on public.fund_reservations;
create policy "own rows" on public.fund_reservations
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke all on public.fund_reservations from anon;
grant select, insert, update, delete on public.fund_reservations to authenticated;

-- 2) Guard: ordinary spending / transfers cannot touch reserved money.
--    Project spending (category PROJECT, posted by project_spend) is checked inside that function.
create or replace function public.transaction_reserve_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  w       wallets%rowtype;
  r       numeric;
  old_out numeric := 0;
begin
  if new.type = 'INCOME' or (new.type = 'EXPENSE' and coalesce(new.category, '') = 'PROJECT') then
    return new;
  end if;
  select * into w from wallets where id = new.wallet_id and user_id = new.user_id;
  if not found then
    return new; -- transaction_validate reports the missing wallet
  end if;
  select coalesce(sum(amount), 0) into r
    from fund_reservations where wallet_id = new.wallet_id and user_id = new.user_id;
  if r = 0 then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.wallet_id = new.wallet_id and old.type in ('EXPENSE', 'TRANSFER') then
    old_out := old.amount;
  end if;
  if w.balance + old_out - new.amount < r then
    raise exception 'Amount exceeds the free balance of "%": % of % is reserved for projects',
      w.name, r, w.balance using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_transaction_reserve_guard on public.transactions;
create trigger trg_transaction_reserve_guard
  before insert or update on public.transactions
  for each row execute function public.transaction_reserve_guard();

-- 3) Pay (part of) a debt from a wallet. Optionally reserve the collected money for a project.
--    p_amount          : in the debt currency (the wallet must use the same currency)
--    p_project         : RECEIVABLE debts only; the money stays in the wallet but is reserved
--    p_project_amount  : the same amount converted to the project currency
--    Also advances the project item that is linked to this debt (collected: IN item when reserved;
--    PAYABLE debts: the OUT item counts as executed spending).
--    SECURITY INVOKER: row-level security applies, nobody can touch another user's rows.
create or replace function public.debt_pay(
  p_debt            uuid,
  p_wallet          uuid,
  p_amount          numeric,
  p_project         uuid    default null,
  p_project_amount  numeric default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  d   debts%rowtype;
  pid uuid;
  fid uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;
  select * into d from debts where id = p_debt;
  if not found then
    raise exception 'Debt not found' using errcode = 'P0002';
  end if;

  if p_project is not null then
    if d.type <> 'RECEIVABLE' then
      raise exception 'Only collected debts can be reserved for a project' using errcode = '22023';
    end if;
    if p_project_amount is null or p_project_amount <= 0 then
      raise exception 'project amount is required' using errcode = '22023';
    end if;
    perform 1 from projects where id = p_project;
    if not found then
      raise exception 'Project not found' using errcode = 'P0002';
    end if;
  end if;

  -- Existing triggers validate the remaining amount / wallet and post the wallet transaction.
  insert into debt_payments (debt_id, wallet_id, amount)
  values (p_debt, p_wallet, round(p_amount, 2))
  returning id into pid;

  if p_project is not null then
    insert into fund_reservations (project_id, wallet_id, debt_payment_id, amount, project_amount)
    values (p_project, p_wallet, pid, round(p_amount, 2), round(p_project_amount, 2));
    update projects set allocated_amount = allocated_amount + round(p_project_amount, 2) where id = p_project;
  end if;

  select c.id into fid
    from project_cashflows c
   where c.debt_id = p_debt
     and c.currency = d.currency
     and not c.is_done
     and ((d.type = 'RECEIVABLE' and c.direction = 'IN' and p_project is not null and c.project_id = p_project)
          or (d.type = 'PAYABLE' and c.direction = 'OUT'))
   order by c.due_date nulls last, c.created_at
   limit 1
   for update;
  if fid is not null then
    update project_cashflows
       set paid_amount = least(amount, coalesce(paid_amount, 0) + round(p_amount, 2)),
           is_done     = least(amount, coalesce(paid_amount, 0) + round(p_amount, 2)) >= amount
     where id = fid;
  end if;

  return jsonb_build_object('ok', true, 'payment_id', pid, 'reserved', p_project is not null);
end $$;

revoke all on function public.debt_pay(uuid, uuid, numeric, uuid, numeric) from public, anon;
grant execute on function public.debt_pay(uuid, uuid, numeric, uuid, numeric) to authenticated;

-- 4) Record spending on a project expense item (partial or full).
--    Without a wallet: only records the spending (money came from outside the app).
--    With a wallet (same currency as the item): posts a real EXPENSE in the wallet and releases the
--    project's reserved money in that wallet (oldest first), lowering "allocated" by the same amount.
create or replace function public.project_spend(p_flow uuid, p_amount numeric, p_wallet uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  f        project_cashflows%rowtype;
  w        wallets%rowtype;
  new_paid numeric(14, 2);
  other_r  numeric;
  left_amt numeric(14, 2);
  take     numeric(14, 2);
  ptake    numeric(14, 2);
  rel      numeric(14, 2) := 0;
  r        record;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  select * into f from project_cashflows where id = p_flow for update;
  if not found then
    raise exception 'cash-flow item not found' using errcode = 'P0002';
  end if;
  if f.direction <> 'OUT' then
    raise exception 'not an expense item' using errcode = '22023';
  end if;
  if coalesce(f.paid_amount, 0) + p_amount > f.amount + 0.004 then
    raise exception 'payment exceeds the remaining amount' using errcode = '22003';
  end if;
  new_paid := least(f.amount, coalesce(f.paid_amount, 0) + round(p_amount, 2));

  if p_wallet is not null then
    select * into w from wallets where id = p_wallet for update;
    if not found then
      raise exception 'Wallet not found' using errcode = 'P0002';
    end if;
    if w.currency <> f.currency then
      raise exception 'The wallet currency (%) must match the item currency (%)', w.currency, f.currency
        using errcode = '22023';
    end if;
    select coalesce(sum(amount), 0) into other_r
      from fund_reservations where wallet_id = p_wallet and project_id <> f.project_id;
    if w.balance - other_r < p_amount then
      raise exception 'Insufficient free balance in "%"', w.name using errcode = '23514';
    end if;

    insert into transactions (wallet_id, type, category, amount, notes)
    values (p_wallet, 'EXPENSE', 'PROJECT', round(p_amount, 2),
            format('%s — %s', (select name from projects where id = f.project_id), f.title));

    left_amt := round(p_amount, 2);
    for r in
      select * from fund_reservations
       where project_id = f.project_id and wallet_id = p_wallet
       order by created_at
         for update
    loop
      exit when left_amt <= 0;
      take := least(r.amount, left_amt);
      if take >= r.amount then
        ptake := r.project_amount;
        delete from fund_reservations where id = r.id;
      else
        ptake := round(r.project_amount * take / r.amount, 2);
        update fund_reservations
           set amount = amount - take, project_amount = project_amount - ptake
         where id = r.id;
      end if;
      left_amt := left_amt - take;
      rel := rel + ptake;
    end loop;
    if rel > 0 then
      update projects set allocated_amount = greatest(0, allocated_amount - rel) where id = f.project_id;
    end if;
  end if;

  update project_cashflows
     set paid_amount = new_paid, is_done = (new_paid >= amount)
   where id = p_flow;

  return jsonb_build_object('ok', true, 'paid_amount', new_paid, 'done', new_paid >= f.amount, 'released', rel);
end $$;

revoke all on function public.project_spend(uuid, numeric, uuid) from public, anon;
grant execute on function public.project_spend(uuid, numeric, uuid) to authenticated;
