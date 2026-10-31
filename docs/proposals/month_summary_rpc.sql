-- PROPOSAL ONLY — NOT a migration, NOT applied. Review in Phase 3 before use.
-- Goal: exact month totals computed in the database (no row limit, no paging),
-- scoped to the caller by RLS (SECURITY INVOKER) — never trusts a client-supplied user id.
create or replace function public.month_summary(p_from timestamptz, p_to timestamptz)
returns table (type text, category text, currency text, total numeric, n bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.type::text, t.category, w.currency::text, sum(t.amount), count(*)
  from public.transactions t
  join public.wallets w on w.id = t.wallet_id
  where t.date >= p_from and t.date < p_to
  group by 1, 2, 3;
$$;
-- The client converts each (type, category, currency) bucket to AED with the same rules as
-- src/lib/stats.ts (exclude DEBT, skip internal transfers, SUDAN_TRANSFER separately).
-- Read-only check you can run today (changes nothing): how many rows fall in the current Dubai month?
--   select count(*) from public.transactions
--   where date >= date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'
--     and date <  (date_trunc('month', now() at time zone 'Asia/Dubai') + interval '1 month') at time zone 'Asia/Dubai';
