#!/usr/bin/env bash
# Rollback rehearsal on the LOCAL db: refused without CONFIRM, applied with CONFIRM, then re-apply 0003.
source "$(dirname "$0")/_common.sh"
R="$ROOT/supabase/rollback/0003_rollback.sql"
if psql_local < "$R" >/dev/null 2>&1; then echo "✘ rollback ran without CONFIRM"; exit 1; else echo "✔ rollback refused without CONFIRM"; fi
sed 's/^-- set rollback.ui_disabled/set rollback.ui_disabled/' "$R" | psql_local >/dev/null && echo "✔ rollback (Level A) applied"
psql_local -At -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and prosecdef and not (coalesce(proconfig,'{}') @> array['search_path=public, pg_temp'])" | grep -qx 0 && echo "✔ all definer functions still pinned"
psql_local < "$ROOT"/supabase/migrations/0003_*.sql >/dev/null && echo "✔ 0003 re-applied after rollback"
