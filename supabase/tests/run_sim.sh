#!/usr/bin/env bash
# Usage: tests/run_sim.sh  — rebuilds a throwaway DB "sim" and applies 0001 + 0003 as the non-superuser owner.
set -euo pipefail
H="psql -h /var/lib/postgresql/p3test -p 54329 -v ON_ERROR_STOP=1 -q"
D=$(cd "$(dirname "$0")/.." && pwd)
sed -n "/^do \$\$ begin/,/^grant anon, authenticated, service_role to pgsim;/p" "$D/tests/supabase_sim_setup.sql" | $H -U postgres -d postgres 2>&1 | grep -v NOTICE || true
$H -U postgres -c "drop database if exists sim" -c "create database sim owner pgsim" 2>&1 | grep -v NOTICE || true
$H -U postgres -d sim -f "$D/tests/supabase_sim_setup.sql" 2>&1 | grep -v NOTICE || true
for f in migrations/0001_init.sql migrations/0003_phase3_financial.sql; do
  $H -U pgsim -d sim -f "$D/$f" 2>&1 | grep -iv notice || true
done
