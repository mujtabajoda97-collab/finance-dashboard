-- =====================================================================
-- PROPOSAL ONLY — NOT APPLIED. Separate from 0003 on purpose.
-- Defence in depth: the app never uses the anon role for table access (sign-in goes through GoTrue; every
-- data policy is "to authenticated"). Supabase's default privileges still hand anon full DML on every new
-- public table; RLS is the only thing stopping it. This removes the grant so a future table created without
-- RLS cannot leak to anonymous callers.
--   * No data, table, policy or function body is touched.
--   * authenticated and service_role privileges are untouched.
--   * Reversible: grant ... to anon (statements at the bottom).
-- =====================================================================
begin;
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
-- future objects created by the migration role (postgres) in public
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on functions from anon;
-- PostgreSQL's built-in default gives PUBLIC (hence anon) EXECUTE on every new function. The per-schema
-- revoke above cannot remove that (verified on the sim), so also remove the global PUBLIC default. It applies
-- to functions later created by role postgres in ANY schema; authenticated / service_role keep their explicit
-- per-schema EXECUTE in public, and every internal function must still revoke them explicitly (as 0003 does).
alter default privileges for role postgres revoke execute on functions from public;
-- The four non-definer trigger functions of 0001 are still executable by anon/authenticated. Trigger functions
-- cannot be called directly and need no EXECUTE at fire time; close the exposure anyway.
revoke execute on function public.forbid_update()         from public, anon, authenticated;
revoke execute on function public.task_before_update()    from public, anon, authenticated;
revoke execute on function public.touch_updated_at()      from public, anon, authenticated;
revoke execute on function public.wallet_opening_balance() from public, anon, authenticated;
commit;

-- Rollback (restores Supabase's defaults):
-- grant all on all tables in schema public to anon;
-- grant all on all sequences in schema public to anon;
-- alter default privileges for role postgres in schema public grant all on tables to anon;
-- alter default privileges for role postgres in schema public grant all on sequences to anon;
-- alter default privileges for role postgres in schema public grant all on functions to anon;
-- alter default privileges for role postgres grant execute on functions to public;
-- grant execute on function public.forbid_update(), public.task_before_update(),
--   public.touch_updated_at(), public.wallet_opening_balance() to public, anon, authenticated;
