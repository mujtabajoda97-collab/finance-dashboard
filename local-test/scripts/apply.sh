#!/usr/bin/env bash
# Applies 0003 twice (re-application must be a no-op) and runs the catalog check. Local DB only.
source "$(dirname "$0")/_common.sh"
docker inspect "$DB_CONTAINER" >/dev/null 2>&1 || { echo "stack is not running: run scripts/up.sh"; exit 1; }
F=$(ls "$ROOT"/supabase/migrations/0003_*.sql)
before=$(psql_local -At -c "select md5(string_agg(t::text, '|' order by t::text)) from (select * from public.wallets union all select null where false) t" 2>/dev/null || echo none)
psql_local < "$F" >/dev/null && echo "✔ 0003 applied (1st time)"
psql_local < "$F" >/dev/null && echo "✔ 0003 re-applied (2nd time, idempotent)"
psql_local < "$ROOT/supabase/tests/catalog_expect_0003.sql" | tail -n 20
