-- =====================================================================
-- Personal Finance & Task Dashboard — Initial schema
-- Supabase / PostgreSQL. Every table is owner-scoped with RLS.
-- Balances, debt progress, recurring tasks and alerts are maintained by
-- triggers so the database stays consistent whatever client writes to it.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------------------------------------------------
do $$ begin
  create type currency_code as enum ('AED', 'SDG', 'USD');
exception when duplicate_object then null; end $$;

do $$ begin
  create type txn_type as enum ('EXPENSE', 'INCOME', 'TRANSFER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type debt_type as enum ('RECEIVABLE', 'PAYABLE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type debt_status as enum ('OPEN', 'PARTIAL', 'PAID');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type period_type as enum ('NONE', 'DAILY', 'WEEKLY', 'MONTHLY');
exception when duplicate_object then null; end $$;

-- ---------- Shared helper -------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- profiles (notification targets & preferences) ----------
create table if not exists public.profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  display_name     text,
  telegram_chat_id text,
  whatsapp_phone   text,
  timezone         text not null default 'Asia/Dubai',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- wallets --------------------------------------------------
create table if not exists public.wallets (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name                  text not null check (length(trim(name)) > 0),
  currency              currency_code not null default 'AED',
  opening_balance       numeric(14, 2) not null default 0,
  balance               numeric(14, 2) not null default 0,
  min_balance_threshold numeric(14, 2) not null default 0 check (min_balance_threshold >= 0),
  is_archived           boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists wallets_user_idx on public.wallets (user_id);

-- ---------- exchange_rates (current rate per pair, per user) --------
create table if not exists public.exchange_rates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  base_currency   currency_code not null,
  target_currency currency_code not null,
  rate            numeric(18, 6) not null check (rate > 0),
  updated_at      timestamptz not null default now(),
  unique (user_id, base_currency, target_currency),
  check (base_currency <> target_currency)
);

-- History of every rate change (useful for charts / audits).
create table if not exists public.exchange_rate_history (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,
  base_currency   currency_code not null,
  target_currency currency_code not null,
  rate            numeric(18, 6) not null,
  recorded_at     timestamptz not null default now()
);

-- ---------- debts ----------------------------------------------------
create table if not exists public.debts (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  person_name      text not null,
  type             debt_type not null,
  currency         currency_code not null default 'AED',
  total_amount     numeric(14, 2) not null check (total_amount > 0),
  paid_amount      numeric(14, 2) not null default 0 check (paid_amount >= 0),
  due_date         date,
  status           debt_status not null default 'OPEN',
  notes            text,
  last_notified_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (paid_amount <= total_amount)
);
create index if not exists debts_user_due_idx on public.debts (user_id, due_date) where status <> 'PAID';

create table if not exists public.debt_payments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  debt_id      uuid not null references public.debts (id) on delete cascade,
  wallet_id    uuid not null references public.wallets (id) on delete restrict,
  amount       numeric(14, 2) not null check (amount > 0),
  payment_date timestamptz not null default now(),
  notes        text,
  created_at   timestamptz not null default now()
);
create index if not exists debt_payments_debt_idx on public.debt_payments (debt_id);

-- ---------- transactions ---------------------------------------------
-- amount is always positive and expressed in the wallet's currency.
-- Direction comes from type: INCOME (+), EXPENSE (-), TRANSFER (- from
-- wallet_id; + to to_wallet_id when moving between own wallets).
create table if not exists public.transactions (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  wallet_id          uuid not null references public.wallets (id) on delete restrict,
  to_wallet_id       uuid references public.wallets (id) on delete restrict,
  to_amount          numeric(14, 2) check (to_amount is null or to_amount > 0),
  type               txn_type not null,
  category           text,
  amount             numeric(14, 2) not null check (amount > 0),
  original_amount    numeric(18, 2),
  original_currency  currency_code,
  exchange_rate_used numeric(18, 6),
  notes              text,
  date               timestamptz not null default now(),
  debt_payment_id    uuid unique references public.debt_payments (id) on delete cascade,
  created_at         timestamptz not null default now(),
  check (to_wallet_id is null or to_wallet_id <> wallet_id),
  check (to_wallet_id is null or type = 'TRANSFER')
);
create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_wallet_idx on public.transactions (wallet_id);

-- ---------- tasks ----------------------------------------------------
create table if not exists public.tasks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title                 text not null check (length(trim(title)) > 0),
  description           text,
  priority              task_priority not null default 'MEDIUM',
  due_date              timestamptz,
  period_type           period_type not null default 'NONE',
  remind_before_minutes integer not null default 60 check (remind_before_minutes >= 0),
  is_completed          boolean not null default false,
  completed_at          timestamptz,
  last_notified_at      timestamptz,
  parent_task_id        uuid references public.tasks (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists tasks_user_open_due_idx on public.tasks (user_id, due_date) where not is_completed;

-- ---------- alert_logs -----------------------------------------------
create table if not exists public.alert_logs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  alert_type   text not null,  -- LOW_BALANCE | DEBT_DUE | DEBT_OVERDUE | TASK_UPCOMING | TASK_OVERDUE
  reference_id uuid,
  message      text not null,
  is_sent      boolean not null default false,
  sent_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists alert_logs_unsent_idx on public.alert_logs (created_at) where not is_sent;

-- =====================================================================
-- Triggers: wallets & balances
-- =====================================================================

-- New wallet starts at its opening balance; editing the opening balance
-- shifts the running balance by the difference.
create or replace function public.wallet_opening_balance()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.balance := new.opening_balance;
  elsif current_user in ('authenticated', 'anon') then
    -- Direct client edits can never set the balance by hand; only the
    -- opening balance (and transactions, via security-definer triggers).
    new.balance := old.balance + (new.opening_balance - old.opening_balance);
  end if;
  return new;
end $$;

drop trigger if exists trg_wallet_opening on public.wallets;
create trigger trg_wallet_opening
  before insert or update on public.wallets
  for each row execute function public.wallet_opening_balance();

drop trigger if exists trg_wallet_touch on public.wallets;
create trigger trg_wallet_touch
  before update on public.wallets
  for each row execute function public.touch_updated_at();

-- Low-balance alert: fires once each time a wallet crosses below its threshold.
create or replace function public.wallet_low_balance_alert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.min_balance_threshold > 0
     and new.balance < new.min_balance_threshold
     and (old.balance >= old.min_balance_threshold
          or old.min_balance_threshold is distinct from new.min_balance_threshold) then
    insert into alert_logs (user_id, alert_type, reference_id, message)
    values (
      new.user_id, 'LOW_BALANCE', new.id,
      format('⚠️ رصيد محفظة "%s" أصبح %s %s، وهو أقل من الحد الأدنى (%s %s).',
             new.name, to_char(new.balance, 'FM999,999,990.00'), new.currency,
             to_char(new.min_balance_threshold, 'FM999,999,990.00'), new.currency)
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_wallet_low_balance on public.wallets;
create trigger trg_wallet_low_balance
  after update of balance, min_balance_threshold on public.wallets
  for each row execute function public.wallet_low_balance_alert();

-- Apply / reverse a transaction's effect on wallet balances.
create or replace function public.apply_transaction(t public.transactions, direction integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if t.type = 'INCOME' then
    update wallets set balance = balance + direction * t.amount where id = t.wallet_id;
  else
    update wallets set balance = balance - direction * t.amount where id = t.wallet_id;
    if t.type = 'TRANSFER' and t.to_wallet_id is not null then
      update wallets
         set balance = balance + direction * coalesce(t.to_amount, t.amount)
       where id = t.to_wallet_id;
    end if;
  end if;
end $$;

create or replace function public.transaction_balance_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform apply_transaction(old, -1);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    -- Wallets must belong to the same user as the transaction.
    if not exists (select 1 from wallets where id = new.wallet_id and user_id = new.user_id)
       or (new.to_wallet_id is not null and not exists
           (select 1 from wallets where id = new.to_wallet_id and user_id = new.user_id)) then
      raise exception 'Wallet not found';
    end if;
    perform apply_transaction(new, 1);
    return new;
  end if;
  return old;
end $$;

drop trigger if exists trg_transaction_balance on public.transactions;
create trigger trg_transaction_balance
  after insert or update or delete on public.transactions
  for each row execute function public.transaction_balance_sync();

-- =====================================================================
-- Triggers: exchange rates
-- =====================================================================
create or replace function public.exchange_rate_log()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.rate is distinct from old.rate then
    insert into exchange_rate_history (user_id, base_currency, target_currency, rate)
    values (new.user_id, new.base_currency, new.target_currency, new.rate);
  end if;
  return new;
end $$;

drop trigger if exists trg_exchange_rate_log on public.exchange_rates;
create trigger trg_exchange_rate_log
  before insert or update on public.exchange_rates
  for each row execute function public.exchange_rate_log();

-- =====================================================================
-- Triggers: debts & installments
-- =====================================================================
create or replace function public.debt_recalc(p_debt_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_paid numeric(14, 2);
begin
  select coalesce(sum(amount), 0) into v_paid from debt_payments where debt_id = p_debt_id;
  update debts
     set paid_amount = v_paid,
         status = case when v_paid = 0 then 'OPEN'::debt_status
                       when v_paid >= total_amount then 'PAID'::debt_status
                       else 'PARTIAL'::debt_status end,
         updated_at = now()
   where id = p_debt_id;
end $$;

-- Each installment: validate, post a wallet transaction, refresh debt progress.
create or replace function public.debt_payment_after_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  d debts%rowtype;
begin
  select * into d from debts where id = new.debt_id and user_id = new.user_id;
  if not found then
    raise exception 'Debt not found';
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

drop trigger if exists trg_debt_payment_insert on public.debt_payments;
create trigger trg_debt_payment_insert
  after insert on public.debt_payments
  for each row execute function public.debt_payment_after_insert();

-- Deleting an installment removes its transaction (cascade reverses the
-- balance) and recalculates the debt.
create or replace function public.debt_payment_after_remove()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform debt_recalc(old.debt_id);
  return old;
end $$;

drop trigger if exists trg_debt_payment_remove on public.debt_payments;
create trigger trg_debt_payment_remove
  after delete on public.debt_payments
  for each row execute function public.debt_payment_after_remove();

-- Installments are immutable once recorded (delete & re-add instead).
create or replace function public.forbid_update()
returns trigger language plpgsql as $$
begin
  raise exception 'Rows in % are immutable; remove and re-create instead.', tg_table_name;
end $$;

drop trigger if exists trg_debt_payment_no_update on public.debt_payments;
create trigger trg_debt_payment_no_update
  before update on public.debt_payments
  for each row execute function public.forbid_update();

drop trigger if exists trg_debt_touch on public.debts;
create trigger trg_debt_touch
  before update on public.debts
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- Triggers: tasks (completion stamp + recurring regeneration)
-- =====================================================================
create or replace function public.task_before_update()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.is_completed and not old.is_completed then
    new.completed_at := coalesce(new.completed_at, now());
  elsif not new.is_completed then
    new.completed_at := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_task_before_update on public.tasks;
create trigger trg_task_before_update
  before update on public.tasks
  for each row execute function public.task_before_update();

create or replace function public.task_spawn_next()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_step interval;
  v_next timestamptz;
begin
  if new.is_completed and not old.is_completed and new.period_type <> 'NONE' then
    v_step := case new.period_type
                when 'DAILY' then interval '1 day'
                when 'WEEKLY' then interval '1 week'
                when 'MONTHLY' then interval '1 month'
              end;
    v_next := coalesce(new.due_date, now()) + v_step;
    -- If the task was done late, skip ahead so the next one is in the future.
    while v_next <= now() loop
      v_next := v_next + v_step;
    end loop;

    insert into tasks (user_id, title, description, priority, due_date, period_type,
                       remind_before_minutes, parent_task_id)
    values (new.user_id, new.title, new.description, new.priority, v_next, new.period_type,
            new.remind_before_minutes, coalesce(new.parent_task_id, new.id));
  end if;
  return new;
end $$;

drop trigger if exists trg_task_spawn_next on public.tasks;
create trigger trg_task_spawn_next
  after update of is_completed on public.tasks
  for each row execute function public.task_spawn_next();

-- =====================================================================
-- New user bootstrap: profile + default USD peg
-- (AED→SDG is left for the user to set from the rate bar.)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict do nothing;

  insert into exchange_rates (user_id, base_currency, target_currency, rate)
  values (new.id, 'AED', 'USD', 0.272294)
  on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Scheduled alert generators (called by pg_cron or n8n)
-- =====================================================================

-- Upcoming tasks, overdue tasks (throttled), and debts due within 3 days.
create or replace function public.generate_due_alerts(p_throttle interval default interval '6 hours')
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  r record;
begin
  -- Tasks starting soon: notify once inside the reminder window.
  for r in
    select * from tasks
     where not is_completed and due_date is not null
       and due_date > now()
       and due_date <= now() + make_interval(mins => remind_before_minutes)
       and (last_notified_at is null or last_notified_at < due_date - make_interval(mins => remind_before_minutes))
  loop
    insert into alert_logs (user_id, alert_type, reference_id, message)
    values (r.user_id, 'TASK_UPCOMING', r.id,
            format('⏰ تذكير: المهمة "%s" موعدها %s.', r.title,
                   to_char(r.due_date at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI')));
    update tasks set last_notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  -- Overdue tasks, at most once per throttle window.
  for r in
    select * from tasks
     where not is_completed and due_date is not null and due_date < now()
       and (last_notified_at is null or last_notified_at < now() - p_throttle)
  loop
    insert into alert_logs (user_id, alert_type, reference_id, message)
    values (r.user_id, 'TASK_OVERDUE', r.id,
            format('🔴 أنت لم تنفذ المهمة "%s"، ويجب أن تبدأ بها الآن.', r.title));
    update tasks set last_notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  -- Debts due in ≤ 3 days or already overdue, once a day.
  for r in
    select * from debts
     where status <> 'PAID' and due_date is not null
       and due_date <= current_date + 3
       and (last_notified_at is null or last_notified_at < now() - interval '1 day')
  loop
    insert into alert_logs (user_id, alert_type, reference_id, message)
    values (r.user_id,
            case when r.due_date < current_date then 'DEBT_OVERDUE' else 'DEBT_DUE' end,
            r.id,
            format('%s %s: %s — المتبقي %s %s (الاستحقاق %s).',
                   case when r.due_date < current_date then '🔴 دين متأخر' else '📅 دين يقترب موعده' end,
                   case when r.type = 'RECEIVABLE' then 'لك عند' else 'عليك لـ' end,
                   r.person_name,
                   to_char(r.total_amount - r.paid_amount, 'FM999,999,990.00'), r.currency,
                   r.due_date));
    update debts set last_notified_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

-- Morning / evening digest: one message per user listing overdue tasks.
create or replace function public.generate_overdue_digest()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select user_id,
           string_agg(format('• %s', title), E'\n' order by due_date) as lines,
           count(*) as n
      from tasks
     where not is_completed and due_date < now()
     group by user_id
  loop
    insert into alert_logs (user_id, alert_type, message)
    values (r.user_id, 'TASK_DIGEST',
            format(E'📋 لديك %s مهام متأخرة لم تُنجز بعد:\n%s\nابدأ بها الآن.', r.n, r.lines));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Only the service role (cron / n8n) may run the generators.
revoke execute on function public.generate_due_alerts(interval) from public, anon, authenticated;
revoke execute on function public.generate_overdue_digest() from public, anon, authenticated;
revoke execute on function public.apply_transaction(public.transactions, integer) from public, anon, authenticated;
revoke execute on function public.debt_recalc(uuid) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.wallet_low_balance_alert() from public, anon, authenticated;
revoke execute on function public.transaction_balance_sync() from public, anon, authenticated;
revoke execute on function public.exchange_rate_log() from public, anon, authenticated;
revoke execute on function public.debt_payment_after_insert() from public, anon, authenticated;
revoke execute on function public.debt_payment_after_remove() from public, anon, authenticated;
revoke execute on function public.task_spawn_next() from public, anon, authenticated;
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
revoke insert, update on public.exchange_rate_history from anon, authenticated;
revoke insert on public.alert_logs from anon, authenticated;
grant execute on function public.generate_due_alerts(interval) to service_role;
grant execute on function public.generate_overdue_digest() to service_role;

-- Pending alerts joined with the user's notification targets (for n8n).
create or replace view public.pending_alerts
with (security_invoker = true) as
select a.*, p.telegram_chat_id, p.whatsapp_phone
  from public.alert_logs a
  left join public.profiles p on p.user_id = a.user_id
 where not a.is_sent;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.profiles              enable row level security;
alter table public.wallets               enable row level security;
alter table public.exchange_rates        enable row level security;
alter table public.exchange_rate_history enable row level security;
alter table public.transactions          enable row level security;
alter table public.debts                 enable row level security;
alter table public.debt_payments         enable row level security;
alter table public.tasks                 enable row level security;
alter table public.alert_logs            enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['profiles', 'wallets', 'exchange_rates', 'transactions',
                           'debts', 'debt_payments', 'tasks']
  loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

-- History and alerts are written by triggers; users can only read
-- (and mark alerts as read/sent from the app).
drop policy if exists "read own" on public.exchange_rate_history;
create policy "read own" on public.exchange_rate_history
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "read own" on public.alert_logs;
create policy "read own" on public.alert_logs
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "update own" on public.alert_logs;
create policy "update own" on public.alert_logs
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Transactions created by a debt installment can only be removed via the
-- installment, so the debt total never drifts.
drop policy if exists "own rows" on public.transactions;
create policy "select own" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "insert own" on public.transactions
  for insert to authenticated
  with check ((select auth.uid()) = user_id and debt_payment_id is null);
create policy "update own manual" on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id and debt_payment_id is null)
  with check ((select auth.uid()) = user_id and debt_payment_id is null);
create policy "delete own manual" on public.transactions
  for delete to authenticated
  using ((select auth.uid()) = user_id and debt_payment_id is null);
