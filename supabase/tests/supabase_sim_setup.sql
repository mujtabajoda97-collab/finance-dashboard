-- Local stand-in for Supabase's role/ACL model (run as a Postgres superuser on a THROWAWAY database).
-- Mirrors: non-superuser object owner "postgres" (here: pgsim, BYPASSRLS), roles anon / authenticated /
-- service_role, PostgREST login role "authenticator" (NOINHERIT), JWT claims read from
-- request.jwt.claims (JSON) like Supabase's auth.uid(), and Supabase's default privileges that GRANT
-- ALL on new tables / sequences / FUNCTIONS in schema public to anon, authenticated, service_role.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='pgsim') then create role pgsim login createrole bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to pgsim;

alter schema public owner to pgsim;
create schema if not exists auth authorization pgsim;
create table auth.users (id uuid primary key, email text);
alter table auth.users owner to pgsim;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
alter function auth.uid() owner to pgsim;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

alter default privileges for role pgsim in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role pgsim in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role pgsim in schema public grant all on functions to anon, authenticated, service_role;
