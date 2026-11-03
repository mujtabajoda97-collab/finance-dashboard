-- =====================================================================
-- 0011 — WhatsApp webhook support (replies to reminders)
--   wa_outbox : which task / debt every sent WhatsApp message was about (written by the app)
--   wa_inbox  : incoming replies analysed by the webhook (written by the server, read by the owner)
-- Run once in the Supabase SQL Editor. Safe to re-run. Does not touch existing tables or data.
-- =====================================================================

create table if not exists public.wa_outbox (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('task','debt')),
  ref_ids       uuid[] not null,
  chat_phone    text not null,            -- digits with country code the message was sent to
  is_own_number boolean not null default false,
  message       text,
  created_at    timestamptz not null default now()
);
create index if not exists wa_outbox_lookup on public.wa_outbox (chat_phone, created_at desc);

create table if not exists public.wa_inbox (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  debt_id         uuid references public.debts(id) on delete cascade,
  msg_id          text unique,            -- Green API message id (prevents duplicates)
  from_phone      text not null,
  body            text not null,
  category        text not null default 'OTHER',  -- EXTENSION | POSTPONE | APOLOGY | PAID_CLAIM | OTHER
  summary         text,
  suggest_days    integer,
  suggested_reply text,
  handled         boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists wa_inbox_user on public.wa_inbox (user_id, handled, created_at desc);

alter table public.wa_outbox enable row level security;
alter table public.wa_inbox  enable row level security;

drop policy if exists wa_outbox_owner on public.wa_outbox;
create policy wa_outbox_owner on public.wa_outbox for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The owner can read and mark replies as handled / delete them; only the server (service role) inserts them.
drop policy if exists wa_inbox_select on public.wa_inbox;
create policy wa_inbox_select on public.wa_inbox for select to authenticated using (user_id = auth.uid());
drop policy if exists wa_inbox_update on public.wa_inbox;
create policy wa_inbox_update on public.wa_inbox for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists wa_inbox_delete on public.wa_inbox;
create policy wa_inbox_delete on public.wa_inbox for delete to authenticated using (user_id = auth.uid());

revoke all on public.wa_outbox from anon;
revoke all on public.wa_inbox  from anon;
