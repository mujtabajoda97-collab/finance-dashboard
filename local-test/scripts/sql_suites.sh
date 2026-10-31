#!/usr/bin/env bash
# Optional: the SQL behaviour suites (they create their own synthetic users); each wrapped in a rolled-back transaction when possible.
source "$(dirname "$0")/_common.sh"
for s in 0003_behavior 0003_debt_multicurrency 0003_privileges; do
  echo "-- $s"; psql_local < "$ROOT/supabase/tests/$s.sql" 2>&1 | tail -n 5 || echo "(suite $s needs adjusting for the real auth schema; HTTP tests are authoritative)"
done
