# shared by all scripts — sourced, not executed
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HARNESS="$ROOT/local-test"
WORK="$HARNESS/.stack"                 # throw-away supabase project dir (git-ignored)
PROJECT_ID="supabase-test-0003"
DB_CONTAINER="supabase_db_${PROJECT_ID}"
# Use a locally installed CLI, or npx with an exact version given in SUPABASE_CLI_VERSION (refuse beta/rc/alpha).
sb() {
  if command -v supabase >/dev/null 2>&1; then supabase "$@";
  else
    : "${SUPABASE_CLI_VERSION:?install the Supabase CLI, or set SUPABASE_CLI_VERSION to an exact STABLE version (e.g. 2.x.y)}"
    case "$SUPABASE_CLI_VERSION" in *beta*|*rc*|*alpha*|*next*) echo "refusing pre-release CLI $SUPABASE_CLI_VERSION"; exit 2;; esac
    npx --yes "supabase@$SUPABASE_CLI_VERSION" "$@"
  fi
}
psql_local() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
